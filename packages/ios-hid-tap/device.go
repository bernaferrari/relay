package main

import (
	"bytes"
	"fmt"
	"image/png"
	"os"
	"strconv"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/instruments"
	"github.com/danielpaulus/go-ios/ios/tunnel"
)

const (
	defaultTunnelInfoHost = "127.0.0.1"
	// Local go-ios advertises the info API on 60105. Relay also uses 28100.
	defaultTunnelInfoPort = 60105
)

var fallbackTunnelInfoPorts = []int{60105, 28100}

func relayTunnelInfoPort() int {
	for _, name := range []string{"RELAY_GO_IOS_TUNNEL_INFO_PORT", "GO_IOS_TUNNEL_INFO_PORT"} {
		if port, err := strconv.Atoi(os.Getenv(name)); err == nil && port > 0 && port <= 65535 {
			return port
		}
	}
	return defaultTunnelInfoPort
}

func resolveDevice(udid, tunnelInfoHost string, tunnelInfoPort int) (ios.DeviceEntry, error) {
	device, err := ios.GetDevice(udid)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("find iOS device %s: %w", udid, err)
	}
	info, err := tunnelInfoForDevice(device.Properties.SerialNumber, tunnelInfoHost, tunnelInfoPort)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("iOS 17+ point tap needs an active go-ios userspace tunnel: %w", err)
	}
	device = deviceWithTunnel(device, info, tunnelInfoHost)
	rsd, err := ios.NewWithAddrPortDevice(info.Address, info.RsdPort, device)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("connect RSD for HID tap: %w", err)
	}
	defer rsd.Close()
	provider, err := rsd.Handshake()
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("handshake RSD for HID tap: %w", err)
	}
	resolved, err := ios.GetDeviceWithAddress(udid, info.Address, provider)
	if err != nil {
		return ios.DeviceEntry{}, fmt.Errorf("resolve tunneled iOS device: %w", err)
	}
	resolved.UserspaceTUN = device.UserspaceTUN
	resolved.UserspaceTUNHost = device.UserspaceTUNHost
	resolved.UserspaceTUNPort = device.UserspaceTUNPort
	return resolved, nil
}

func tunnelInfoForDevice(udid, host string, preferredPort int) (tunnel.Tunnel, error) {
	ports := []int{preferredPort}
	for _, port := range fallbackTunnelInfoPorts {
		if port != preferredPort {
			ports = append(ports, port)
		}
	}
	var last error
	for _, port := range ports {
		info, err := tunnel.TunnelInfoForDevice(udid, host, port)
		if err == nil {
			return info, nil
		}
		last = err
	}
	return tunnel.Tunnel{}, last
}

func deviceWithTunnel(device ios.DeviceEntry, info tunnel.Tunnel, host string) ios.DeviceEntry {
	device.UserspaceTUN = info.UserspaceTUN
	device.UserspaceTUNHost = host
	device.UserspaceTUNPort = info.UserspaceTUNPort
	return device
}

func screenshotSize(device ios.DeviceEntry) (int, int, error) {
	service, err := instruments.NewScreenshotService(device)
	if err != nil {
		return 0, 0, fmt.Errorf("open Instruments screenshot service: %w", err)
	}
	defer service.Close()
	pngBytes, err := service.TakeScreenshot()
	if err != nil {
		return 0, 0, fmt.Errorf("capture Instruments screenshot for HID scale: %w", err)
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(pngBytes))
	if err != nil {
		return 0, 0, fmt.Errorf("decode screenshot header: %w", err)
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return 0, 0, fmt.Errorf("screenshot has no size")
	}
	return cfg.Width, cfg.Height, nil
}
