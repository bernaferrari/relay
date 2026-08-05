#import <TargetConditionals.h>

#if TARGET_OS_OSX
#import <Cocoa/Cocoa.h>

@interface AgentDeviceRunnerAppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSWindow *window;
@end

@implementation AgentDeviceRunnerAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;

  NSRect frame = NSMakeRect(0, 0, 360, 220);
  self.window = [[NSWindow alloc] initWithContentRect:frame
                                            styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                       NSWindowStyleMaskMiniaturizable)
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.title = @"Agent Device Runner";

  NSTextField *label = [NSTextField labelWithString:@"Agent Device Runner"];
  label.font = [NSFont systemFontOfSize:20 weight:NSFontWeightSemibold];
  label.translatesAutoresizingMaskIntoConstraints = NO;

  NSView *contentView = [[NSView alloc] initWithFrame:frame];
  [contentView addSubview:label];
  self.window.contentView = contentView;

  [NSLayoutConstraint activateConstraints:@[
    [label.centerXAnchor constraintEqualToAnchor:contentView.centerXAnchor],
    [label.centerYAnchor constraintEqualToAnchor:contentView.centerYAnchor],
  ]];

  [self.window center];
  [self.window makeKeyAndOrderFront:nil];
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;

  @autoreleasepool {
    NSApplication *application = [NSApplication sharedApplication];
    AgentDeviceRunnerAppDelegate *delegate = [[AgentDeviceRunnerAppDelegate alloc] init];
    application.delegate = delegate;
    [application setActivationPolicy:NSApplicationActivationPolicyRegular];
    [application run];
  }

  return 0;
}

#else
#import <UIKit/UIKit.h>

@interface AgentDeviceRunnerViewController : UIViewController
@property(nonatomic, strong) UITextView *clipboardProbe;
@end

@implementation AgentDeviceRunnerViewController

- (void)viewDidLoad {
  [super viewDidLoad];

  self.view.backgroundColor = UIColor.whiteColor;

  UILabel *label = [[UILabel alloc] init];
  label.text = @"Agent Device Runner";
  label.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle2];
  label.textAlignment = NSTextAlignmentCenter;
  label.translatesAutoresizingMaskIntoConstraints = NO;

  UITextView *clipboardProbe = [[UITextView alloc] init];
  clipboardProbe.accessibilityIdentifier = @"agent-device.clipboard.probe";
  clipboardProbe.font = [UIFont preferredFontForTextStyle:UIFontTextStyleBody];
  clipboardProbe.layer.borderColor = UIColor.separatorColor.CGColor;
  clipboardProbe.layer.borderWidth = 1;
  clipboardProbe.layer.cornerRadius = 8;
  clipboardProbe.autocorrectionType = UITextAutocorrectionTypeNo;
  clipboardProbe.spellCheckingType = UITextSpellCheckingTypeNo;
  clipboardProbe.translatesAutoresizingMaskIntoConstraints = NO;

  NSString *encodedText = NSProcessInfo.processInfo.environment[@"AGENT_DEVICE_CLIPBOARD_PROBE_TEXT_BASE64"];
  if (encodedText.length > 0) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:encodedText options:0];
    if (data != nil) {
      clipboardProbe.text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    }
  }
  self.clipboardProbe = clipboardProbe;

  UIButton *copyButton = [UIButton buttonWithType:UIButtonTypeSystem];
  copyButton.accessibilityIdentifier = @"agent-device.clipboard.copy";
  [copyButton setTitle:@"Copy probe" forState:UIControlStateNormal];
  [copyButton addTarget:self action:@selector(copyProbeText) forControlEvents:UIControlEventTouchUpInside];
  copyButton.translatesAutoresizingMaskIntoConstraints = NO;

  [self.view addSubview:label];
  [self.view addSubview:clipboardProbe];
  [self.view addSubview:copyButton];
  [NSLayoutConstraint activateConstraints:@[
    [label.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
    [label.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor constant:-36],
    [clipboardProbe.topAnchor constraintEqualToAnchor:label.bottomAnchor constant:24],
    [clipboardProbe.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
    [clipboardProbe.widthAnchor constraintEqualToConstant:280],
    [clipboardProbe.heightAnchor constraintEqualToConstant:88],
    [copyButton.topAnchor constraintEqualToAnchor:clipboardProbe.bottomAnchor constant:16],
    [copyButton.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
    [copyButton.widthAnchor constraintGreaterThanOrEqualToConstant:120],
    [copyButton.heightAnchor constraintEqualToConstant:44],
  ]];
}

- (void)copyProbeText {
  UIPasteboard.generalPasteboard.string = self.clipboardProbe.text ?: @"";
}

@end

#if defined(TARGET_OS_VISION) && TARGET_OS_VISION
@interface AgentDeviceRunnerSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation AgentDeviceRunnerSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions {
  (void)session;
  (void)connectionOptions;

  if (![scene isKindOfClass:UIWindowScene.class]) {
    return;
  }

  self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
  self.window.rootViewController = [[AgentDeviceRunnerViewController alloc] init];
  [self.window makeKeyAndVisible];
}

@end
#endif

@interface AgentDeviceRunnerAppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation AgentDeviceRunnerAppDelegate

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary<UIApplicationLaunchOptionsKey, id> *)launchOptions {
  (void)application;
  (void)launchOptions;

#if defined(TARGET_OS_VISION) && TARGET_OS_VISION
  return YES;
#else
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.rootViewController = [[AgentDeviceRunnerViewController alloc] init];
  [self.window makeKeyAndVisible];

  return YES;
#endif
}

#if defined(TARGET_OS_VISION) && TARGET_OS_VISION
- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options {
  (void)application;
  (void)connectingSceneSession;
  (void)options;

  UISceneConfiguration *configuration =
      [[UISceneConfiguration alloc] initWithName:@"Default Configuration"
                                     sessionRole:UIWindowSceneSessionRoleApplication];
  configuration.delegateClass = AgentDeviceRunnerSceneDelegate.class;
  return configuration;
}
#endif

@end

int main(int argc, char *argv[]) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass(AgentDeviceRunnerAppDelegate.class));
  }
}

#endif
