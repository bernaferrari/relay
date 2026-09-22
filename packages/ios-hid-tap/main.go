// relay-ios-hid-tap delivers one iOS point tap over CoreDevice Universal HID.
//
// It does not use XCTest, WebDriverAgent, DeviceKit, or `ios ui`. Pixels come
// from Instruments screenshots elsewhere; this binary only synthesizes a
// digitizer contact+release. backboardd drops those reports unless a
// CoreDevice media stream is authenticating the surface. On iOS 17 through
// 26, starting that stream returns CoreDevice error 9021 (remote control
// requires iOS 27), so this process refuses before sending and names
// universalhidservice. That refusal has not touched the glass; the caller
// may press through XCTest.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/danielpaulus/go-ios/ios"
)

const helperVersion = "relay-ios-hid-tap/1"

type options struct {
	udid           string
	x              int
	y              int
	width          int
	height         int
	hidX           int
	hidY           int
	listServices   bool
	tunnelInfoHost string
	tunnelInfoPort int
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "relay-ios-hid-tap:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer, _ io.Writer) error {
	options, showVersion, err := parseOptions(args)
	if err != nil {
		return err
	}
	if showVersion {
		_, err := fmt.Fprintln(stdout, helperVersion)
		return err
	}
	if options.udid == "" {
		return errors.New("--udid is required")
	}

	device, err := resolveDevice(options.udid, options.tunnelInfoHost, options.tunnelInfoPort)
	if err != nil {
		return err
	}
	if options.listServices {
		if device.Rsd == nil {
			return errors.New("RSD handshake returned no service list")
		}
		for name := range device.Rsd.GetServices() {
			fmt.Fprintln(stdout, name)
		}
		return nil
	}

	if err := requireAuthenticatedHidSurface(device); err != nil {
		return err
	}

	hidX, hidY, err := resolveHidPoint(device, options)
	if err != nil {
		return err
	}

	conn, err := connectUniversalHID(device)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := tapTouchscreen(conn, hidX, hidY); err != nil {
		return err
	}
	// Give backboardd a beat to dispatch before the channel closes.
	time.Sleep(40 * time.Millisecond)
	_, err = fmt.Fprintf(stdout, "tapped hid=%d,%d\n", hidX, hidY)
	return err
}

func resolveHidPoint(device ios.DeviceEntry, options options) (uint16, uint16, error) {
	if options.hidX >= 0 && options.hidY >= 0 {
		return uint16(options.hidX), uint16(options.hidY), nil
	}
	if options.x < 0 || options.y < 0 {
		return 0, 0, errors.New("--x and --y (screenshot pixels) or --hid-x and --hid-y are required")
	}
	width, height := options.width, options.height
	if width < 1 || height < 1 {
		var err error
		width, height, err = screenshotSize(device)
		if err != nil {
			return 0, 0, err
		}
	}
	return pixelToHid(options.x, width), pixelToHid(options.y, height), nil
}

func parseOptions(args []string) (options, bool, error) {
	defaults := options{
		x:              -1,
		y:              -1,
		hidX:           -1,
		hidY:           -1,
		tunnelInfoHost: defaultTunnelInfoHost,
		tunnelInfoPort: relayTunnelInfoPort(),
	}
	flags := flag.NewFlagSet("relay-ios-hid-tap", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&defaults.udid, "udid", "", "iOS device UDID")
	flags.IntVar(&defaults.x, "x", defaults.x, "screenshot pixel X")
	flags.IntVar(&defaults.y, "y", defaults.y, "screenshot pixel Y")
	flags.IntVar(&defaults.width, "width", 0, "screenshot width in pixels")
	flags.IntVar(&defaults.height, "height", 0, "screenshot height in pixels")
	flags.IntVar(&defaults.hidX, "hid-x", defaults.hidX, "already-normalized HID X (0..65535)")
	flags.IntVar(&defaults.hidY, "hid-y", defaults.hidY, "already-normalized HID Y (0..65535)")
	flags.BoolVar(&defaults.listServices, "list-services", false, "print tunneled RSD service names and exit")
	flags.StringVar(&defaults.tunnelInfoHost, "tunnel-info-host", defaults.tunnelInfoHost, "go-ios tunnel info host")
	flags.IntVar(&defaults.tunnelInfoPort, "tunnel-info-port", defaults.tunnelInfoPort, "go-ios tunnel info port")
	showVersion := flags.Bool("version", false, "print helper version")
	if err := flags.Parse(args); err != nil {
		return options{}, false, err
	}
	if defaults.tunnelInfoPort < 1 || defaults.tunnelInfoPort > 65535 {
		return options{}, false, fmt.Errorf("--tunnel-info-port must be between 1 and 65535")
	}
	return defaults, *showVersion, nil
}
