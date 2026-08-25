// relay-ios-preview is a deliberately narrow, pixel-only iOS preview source.
//
// It uses the public go-ios Instruments screenshot service, but it does not
// use go-ios's HTTP MJPEG server. That implementation starts a goroutine for
// every frame/client and closes channels under concurrent senders. Relay keeps
// one parent pipe instead, with a bounded newest-frame handoff in this binary.
package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/instruments"
	"github.com/danielpaulus/go-ios/ios/tunnel"
)

const (
	// The public go-ios module is pinned in go.mod. Keep this value in the
	// executable too, so a local build can report the exact source provenance.
	producerVersion            = "relay-ios-preview/1 go-ios=v1.2.2-0.20260805152531-ebec9a0b076c"
	defaultTunnelInfoHost      = "127.0.0.1"
	defaultRelayTunnelInfoPort = 28100
	shutdownGrace              = 2 * time.Second

	// A transient Instruments hiccup (USB renegotiation, tunnel blip) must not
	// kill the preview: exit only after this many consecutive capture failures.
	maxConsecutiveCaptureFailures = 3
	captureRetryBackoff           = 250 * time.Millisecond
	// Instruments screenshot polling has no natural rate limit; hammering it
	// burns USB bandwidth and destabilizes the connection. 10 FPS cap.
	minFrameInterval = 100 * time.Millisecond
)

type options struct {
	udid           string
	tunnelInfoHost string
	tunnelInfoPort int
	quality        int
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "relay-ios-preview:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.WriteCloser, stderr io.Writer) error {
	options, showVersion, err := parseOptions(args)
	if err != nil {
		return err
	}
	if showVersion {
		_, err := fmt.Fprintln(stdout, producerVersion)
		return err
	}
	if options.udid == "" {
		return errors.New("--udid is required")
	}

	logger := log.New(stderr, "relay-ios-preview: ", log.LstdFlags|log.Lmicroseconds)
	device, err := resolveDevice(options)
	if err != nil {
		return err
	}
	service, err := instruments.NewScreenshotService(device)
	if err != nil {
		return fmt.Errorf("open Instruments screenshot service: %w", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	closeForShutdown := closeOnce(service.Close, func() { _ = stdout.Close() })
	defer closeForShutdown()
	go func() {
		<-ctx.Done()
		closeForShutdown()
	}()

	slot := newLatestFrame()
	errs := make(chan error, 2)
	go func() {
		errs <- captureFrames(ctx, service, slot, options.quality)
	}()
	go func() {
		errs <- writeLatestFrames(ctx, stdout, slot)
	}()

	first := <-errs
	cancel()
	closeForShutdown()
	select {
	case second := <-errs:
		return firstNonCancellation(first, second)
	case <-time.After(shutdownGrace):
		// Relay escalates this child to SIGKILL if it does not exit. Returning
		// lets the process terminate normally in the common cancellation path.
		logger.Printf("shutdown exceeded %s", shutdownGrace)
		return firstNonCancellation(first, context.DeadlineExceeded)
	}
}

// closeOnce prevents a signal, a pipe failure, and normal function cleanup
// from racing to close the underlying Instruments connection.
func closeOnce(closers ...func()) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			for _, close := range closers {
				close()
			}
		})
	}
}

func firstNonCancellation(first, second error) error {
	for _, err := range []error{first, second} {
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
	}
	return nil
}

func parseOptions(args []string) (options, bool, error) {
	defaults := options{
		tunnelInfoHost: defaultTunnelInfoHost,
		tunnelInfoPort: relayTunnelInfoPort(),
		quality:        80,
	}
	flags := flag.NewFlagSet("relay-ios-preview", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&defaults.udid, "udid", "", "iOS device UDID")
	flags.StringVar(&defaults.tunnelInfoHost, "tunnel-info-host", defaults.tunnelInfoHost, "go-ios tunnel info host")
	flags.IntVar(&defaults.tunnelInfoPort, "tunnel-info-port", defaults.tunnelInfoPort, "go-ios tunnel info port")
	flags.IntVar(&defaults.quality, "quality", defaults.quality, "JPEG quality (1-100)")
	showVersion := flags.Bool("version", false, "print producer version")
	if err := flags.Parse(args); err != nil {
		return options{}, false, err
	}
	if defaults.tunnelInfoPort < 1 || defaults.tunnelInfoPort > 65535 {
		return options{}, false, fmt.Errorf("--tunnel-info-port must be between 1 and 65535")
	}
	if defaults.quality < 1 || defaults.quality > 100 {
		return options{}, false, fmt.Errorf("--quality must be between 1 and 100")
	}
	return defaults, *showVersion, nil
}

func relayTunnelInfoPort() int {
	for _, name := range []string{"RELAY_GO_IOS_TUNNEL_INFO_PORT", "GO_IOS_TUNNEL_INFO_PORT"} {
		if port, err := strconv.Atoi(os.Getenv(name)); err == nil && port > 0 && port <= 65535 {
			return port
		}
	}
	return defaultRelayTunnelInfoPort
}

func resolveDevice(options options) (ios.DeviceEntry, error) {
	device, err := ios.GetDevice(options.udid)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("find iOS device %s: %w", options.udid, err)
	}

	info, err := tunnel.TunnelInfoForDevice(
		device.Properties.SerialNumber,
		options.tunnelInfoHost,
		options.tunnelInfoPort,
	)
	if err != nil {
		// Direct USB works without an RSD tunnel. A missing tunnel is not a
		// reason to reject a device that Instruments can still reach directly.
		return device, nil
	}
	// This has to happen before the RSD handshake. On a userspace tunnel,
	// NewWithAddrPortDevice dials Relay's local TCP forwarder rather than the
	// device's IPv6 address directly. This mirrors go-ios's CLI resolver.
	device = deviceWithTunnel(device, info, options.tunnelInfoHost)
	rsd, err := ios.NewWithAddrPortDevice(info.Address, info.RsdPort, device)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("connect RSD for iOS preview: %w", err)
	}
	defer rsd.Close()
	provider, err := rsd.Handshake()
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("handshake RSD for iOS preview: %w", err)
	}
	resolved, err := ios.GetDeviceWithAddress(options.udid, info.Address, provider)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("resolve tunneled iOS device: %w", err)
	}
	resolved.UserspaceTUN = device.UserspaceTUN
	resolved.UserspaceTUNHost = device.UserspaceTUNHost
	resolved.UserspaceTUNPort = device.UserspaceTUNPort
	return resolved, nil
}

func deviceWithTunnel(device ios.DeviceEntry, info tunnel.Tunnel, host string) ios.DeviceEntry {
	device.UserspaceTUN = info.UserspaceTUN
	device.UserspaceTUNHost = host
	device.UserspaceTUNPort = info.UserspaceTUNPort
	return device
}

type screenshotService interface {
	TakeScreenshot() ([]byte, error)
}

// captureFrames polls the Instruments screenshot service forever, surviving
// transient TakeScreenshot errors with a bounded retry/backoff. It exits only
// after maxConsecutiveCaptureFailures failures in a row or on cancellation.
// A minimum frame interval caps the poll at ~10 FPS.
func captureFrames(ctx context.Context, service screenshotService, slot *latestFrame, quality int) error {
	consecutiveFailures := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		frameStart := time.Now()
		pngBytes, err := service.TakeScreenshot()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			consecutiveFailures++
			if consecutiveFailures >= maxConsecutiveCaptureFailures {
				return fmt.Errorf("capture Instruments screenshot after %d consecutive attempts: %w",
					consecutiveFailures, err)
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(captureRetryBackoff):
			}
			continue
		}
		consecutiveFailures = 0
		jpegBytes, err := pngToJPEG(pngBytes, quality)
		if err != nil {
			return err
		}
		slot.offer(jpegBytes)
		// Keep the poll bounded even when captures return instantly.
		if elapsed := time.Since(frameStart); elapsed < minFrameInterval {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(minFrameInterval - elapsed):
			}
		}
	}
}

func pngToJPEG(pngBytes []byte, quality int) ([]byte, error) {
	image, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("decode Instruments PNG: %w", err)
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, image, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode preview JPEG: %w", err)
	}
	return encoded.Bytes(), nil
}
