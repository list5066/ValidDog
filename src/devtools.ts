/**
 * DevToolsスクリプト
 *
 * DevToolsパネルを作成
 */

// DevToolsパネルを作成
chrome.devtools.panels.create('ShibaGuard', 'icons/icon16.png', 'panel.html', () => {
  console.log('ShibaGuard panel created');
});
