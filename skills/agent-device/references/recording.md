# Recording

## iOS Simulator

Use simctl recordVideo directly for now:

```bash
xcrun simctl io booted recordVideo /tmp/recording.mov
```

Stop with Ctrl+C.

## Android Emulator/Device

Use adb screenrecord:

```bash
adb -s <serial> shell screenrecord /sdcard/recording.mp4
adb -s <serial> pull /sdcard/recording.mp4 ./recording.mp4
```

Stop with Ctrl+C.
