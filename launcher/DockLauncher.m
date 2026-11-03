#import <Cocoa/Cocoa.h>
@interface StudioDelegate : NSObject <NSApplicationDelegate>
@property NSTask *service;
@property NSFileHandle *log;
@property NSStatusItem *status;
@property NSString *root;
@property NSString *node;
@property BOOL opening;
@property BOOL quitting;
@end
@implementation StudioDelegate
- (void)error:(NSString *)message {
 NSAlert *alert=[NSAlert new]; alert.messageText=@"FWRD.STUDIO V2 couldn’t open"; alert.informativeText=message; [alert runModal];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.root=[[NSBundle mainBundle] objectForInfoDictionaryKey:@"StudioSourcePath"];
 if (![[NSFileManager defaultManager] fileExistsAtPath:[self.root stringByAppendingPathComponent:@"server.mjs"]]) { [self error:@"The V2 master source folder has moved. Restore it to its original location."]; [NSApp terminate:nil]; return; }
 for (NSString *path in @[@"/usr/local/bin/node",@"/opt/homebrew/bin/node"]) {
  NSTask *check=[NSTask new]; check.executableURL=[NSURL fileURLWithPath:path]; check.arguments=@[@"-e",@"process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"]; check.standardOutput=[NSFileHandle fileHandleWithNullDevice]; check.standardError=[NSFileHandle fileHandleWithNullDevice];
  if ([check launchAndReturnError:nil]) { [check waitUntilExit]; if(check.terminationStatus==0) {self.node=path; break;} }
 }
 if(!self.node) { [self error:@"Install Node.js 22 or newer, then reopen V2."]; [NSApp terminate:nil]; return; }
 NSMenu *main=[NSMenu new]; NSMenuItem *appItem=[NSMenuItem new]; [main addItem:appItem]; NSMenu *appMenu=[NSMenu new]; [appMenu addItemWithTitle:@"Open FWRD.STUDIO V2" action:@selector(openStudio:) keyEquivalent:@"o"]; [appMenu addItemWithTitle:@"Quit FWRD.STUDIO V2" action:@selector(terminate:) keyEquivalent:@"q"]; appItem.submenu=appMenu; NSApp.mainMenu=main;
 self.status=[[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength]; self.status.button.title=@"FS2"; self.status.button.toolTip=@"FWRD.STUDIO V2 — master workspace";
 NSMenu *menu=[NSMenu new]; NSMenuItem *open=[menu addItemWithTitle:@"Open FWRD.STUDIO V2" action:@selector(openStudio:) keyEquivalent:@""]; open.target=self;
 NSMenuItem *files=[menu addItemWithTitle:@"Show master source folder" action:@selector(showSource:) keyEquivalent:@""]; files.target=self;
 [menu addItem:[NSMenuItem separatorItem]]; [menu addItemWithTitle:@"Quit FWRD.STUDIO V2" action:@selector(terminate:) keyEquivalent:@"q"]; self.status.menu=menu;
 [self openStudio:nil];
}
- (void)showSource:(id)sender { [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:self.root]]; }
- (void)openStudio:(id)sender {
 if(self.opening || self.quitting) return;
 self.opening=YES;
 if(!self.service.running) {
  NSString *logPath=[self.root stringByAppendingPathComponent:@".local/service.log"];
  if(![[NSFileManager defaultManager] fileExistsAtPath:logPath]) [[NSFileManager defaultManager] createFileAtPath:logPath contents:nil attributes:@{NSFilePosixPermissions:@0600}];
  self.log=[NSFileHandle fileHandleForWritingAtPath:logPath]; [self.log seekToEndOfFile];
  NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:self.node]; task.currentDirectoryURL=[NSURL fileURLWithPath:self.root]; task.arguments=@[[self.root stringByAppendingPathComponent:@"service.mjs"]];
  NSMutableDictionary *env=[[[NSProcessInfo processInfo] environment] mutableCopy];
  for(NSString *key in [env.allKeys copy]) if([key hasPrefix:@"FRAME_"] || [key hasPrefix:@"NODE_"] || [@[@"FAL_KEY",@"OPENROUTER_API_KEY",@"COMFY_API_KEY"] containsObject:key]) [env removeObjectForKey:key];
  env[@"PORT"]=@"4322"; env[@"FRAME_OPEN_BROWSER"]=@"0"; task.environment=env; task.standardOutput=self.log; task.standardError=self.log;
  NSError *error=nil; if(![task launchAndReturnError:&error]) {self.opening=NO; [self error:error.localizedDescription]; return;} self.service=task;
 }
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
  NSTask *wait=[NSTask new]; NSPipe *output=[NSPipe pipe]; wait.executableURL=[NSURL fileURLWithPath:self.node]; wait.currentDirectoryURL=[NSURL fileURLWithPath:self.root]; wait.arguments=@[[self.root stringByAppendingPathComponent:@"launcher.mjs"],@"--no-open"]; wait.standardOutput=output; wait.standardError=output;
  NSError *error=nil; BOOL started=[wait launchAndReturnError:&error]; NSData *data=started ? [output.fileHandleForReading readDataToEndOfFile] : nil; if(started) [wait waitUntilExit];
  dispatch_async(dispatch_get_main_queue(), ^{
   self.opening=NO; if(self.quitting) return;
   if(started && wait.terminationStatus==0) [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"http://127.0.0.1:4322/"]];
   else [self error:error.localizedDescription ?: [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"Check .local/service.log in your master source folder."];
  });
 });
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)visible { [self openStudio:nil]; return NO; }
- (void)applicationWillTerminate:(NSNotification *)notification {self.quitting=YES; if(self.service.running) [self.service terminate]; [self.log closeFile];}
@end
int main(int argc,const char *argv[]) { @autoreleasepool { NSApplication *app=[NSApplication sharedApplication]; StudioDelegate *delegate=[StudioDelegate new]; app.delegate=delegate; [app setActivationPolicy:NSApplicationActivationPolicyRegular]; [app run]; } return 0; }
