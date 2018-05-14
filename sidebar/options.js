////////////////////////////////////////////////////////////////////////////////
// global

function init() {
	localize();
	captureKeyEvents();
	disableContextMenu();
	document.getElementById("browserAction_0").onchange = onBrowserActionChange;
	document.getElementById("browserAction_1").onchange = onBrowserActionChange;
	document.getElementById("treeMode_0").onchange = onTreeModeChange;
	document.getElementById("treeMode_1").onchange = onTreeModeChange;
	document.getElementById("maxRequests").onchange = onMaxRequestsChange;
	document.getElementById("upwardMargin").onchange = onUpwardMarginChange;
	document.getElementById("openInterval").onchange = onOpenIntervalChange;
	document.getElementById("clickBehavior_1").onchange = onClickBehaviorChange;
	document.getElementById("clickBehavior_2").onchange = onClickBehaviorChange;;
	document.getElementById("https").onchange = onHttpsChange;
	document.getElementById("backupButton").onclick = onBackupButton;
	document.getElementById("restoreButton").onchange = onRestoreButton;
	document.getElementById("links").onclick = onLinksClick;
	// 初期選択
	var browserAction = FoxAgeSvc.getPref("browserAction");
	document.getElementById("browserAction_" + browserAction).checked = true;
	var treeMode = FoxAgeSvc.getPref("treeMode");
	document.getElementById("treeMode_" + treeMode).checked = true;
	var clickBehavior = FoxAgeSvc.getPref("clickBehavior");
	document.getElementById("clickBehavior_1").checked = clickBehavior >= 1;
	document.getElementById("clickBehavior_2").checked = clickBehavior == 2;
	var upwardMargin = FoxAgeSvc.getPref("upwardMargin");
	document.getElementById("upwardMargin").value = upwardMargin;
	var openInterval = FoxAgeSvc.getPref("openInterval");
	document.getElementById("openInterval").value = openInterval;
	var https = FoxAgeSvc.getPref("https");
	document.getElementById("https").checked = https;
	var maxRequests = FoxAgeSvc.getPref("maxRequests");
	document.getElementById("maxRequests").selectedIndex = maxRequests - 1;
	// HTMLのタイトル
	document.title += " - " + browser.i18n.getMessage("options");
	// iframe内での読み込み時
	if (window.top.location.href != window.location.href) {
		// 戻るボタンを表示
		document.getElementById("toolbar").hidden = false;
		document.getElementById("backButton").onclick = window.top.hideLayer;
		fitToContent();
	}
	document.body.setAttribute("preload", "false");
}

function uninit() {
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function onBrowserActionChange(event) {
	FoxAgeSvc.setPref("browserAction", parseInt(event.target.value, 10));
}

function onTreeModeChange(event) {
	FoxAgeSvc.setPref("treeMode", parseInt(event.target.value, 10));
	// ２ペーンに変更時、デフォルトで先頭の板を開く
	if (FoxAgeSvc.getPref("treeMode") == 1 && FoxAgeSvc.getPref("lastSubPane") == "") {
		var item = FoxAgeSvc.getChildItems("root").find(item => item.type == FoxAgeUtils.TYPE_BOARD);
		if (item)
			FoxAgeSvc.setPref("lastSubPane", item.id);
		console.log("auto-set lastSubPane: " + FoxAgeSvc.getPref("lastSubPane"));	// #debug
	}
	FoxAgeSvc._notify("reload-data");
}

function onMaxRequestsChange(event) {
	FoxAgeSvc.setPref("maxRequests", parseInt(event.target.value, 10));
}

function onClickBehaviorChange(event) {
	let clickBehavior = 0;
	if (document.getElementById("clickBehavior_1").checked) {
		clickBehavior = 1;
		if (document.getElementById("clickBehavior_2").checked)
			clickBehavior = 2;
	}
	FoxAgeSvc.setPref("clickBehavior", clickBehavior);
}

function onUpwardMarginChange(event) {
	FoxAgeSvc.setPref("upwardMargin", parseInt(event.target.value, 10));
}

function onOpenIntervalChange(event) {
	FoxAgeSvc.setPref("openInterval", parseInt(event.target.value, 10));
}

function onHttpsChange(event) {
	FoxAgeSvc.setPref("https", event.target.checked);
}

function onBackupButton(event) {
	FoxAgeSvc.backupData();
}

function onRestoreButton(event) {
	let file = this.files[0];
	if (!window.confirm(browser.i18n.getMessage("restore_confirm") + "\n" + file.name))
		return;
	let reader = new FileReader();
	reader.onloadend = function() {
		try {
			FoxAgeSvc.restoreData(JSON.parse(reader.result));
		}
		catch(ex) {
			// 復元できないデータ
			alert(browser.i18n.getMessage("error") + "\n" + ex);
		}
	};
	reader.readAsText(file);
}

function onLinksClick(event) {
	var url = event.target.getAttribute("href");
	if (url)
		browser.tabs.create({ url, active: true });
}

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

