////////////////////////////////////////////////////////////////////////////////
// global

var gBoardItem;
var gLogger;
var gRequest;

async function init() {
	await getService();
	localize();
	captureKeyEvents();
	disableContextMenu();
	document.getElementById("backButton").onclick = window.top.hideLayer;
	document.getElementById("cancelButton").onclick = window.top.hideLayer;
	document.getElementById("execButton").onclick = doTransfer;
	fitToContent();
	// URLの?以降からIDを取得
	gBoardItem = FoxAgeSvc.getItem(window.location.search.substr(1));
	if (!gBoardItem)
		return;
	gLogger = document.getElementById("logger");
	trace(gBoardItem.title);
	document.getElementById("oldhost").value = gBoardItem.id.substr(0, gBoardItem.id.indexOf("/"));
	fitToContent();
	document.body.setAttribute("preload", "false");
	// 自動検出開始
	var url = FoxAgeUtils.parseToURL(gBoardItem, FoxAgeSvc.getPref("https"));
	setTimeout(() => autoDetect(url), 0);
}

function uninit() {
	if (gRequest) {
		gRequest.destroy();
		gRequest = null;
	}
	gBoardItem = null;
	gLogger = null;
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function autoDetect(aURL) {
	var errorCallback = aHttpStatus => {
		document.getElementById("throbber").src = "";
		if (aHttpStatus != 200) {
			trace(browser.i18n.getMessage("error") + " (" + aHttpStatus + ")");
			return;
		}
		// HTTPステータス200かつエラーコールバックならリダイレクト
		var newURL = gRequest._request.responseURL;
		if (!/^https?:\/\/([^\/]+)\//.test(newURL))
			return alert(newURL);
		document.getElementById("newhost").value = RegExp.$1;
//		document.getElementById("https").checked = newURL.startsWith("https://");
		trace(browser.i18n.getMessage("done"));
	};
	var loadCallback = aResponseText => {
		if (aResponseText.indexOf("Change your bookmark ASAP.") > 0 && 
		    aResponseText.match(/window\.location\.href=\"([^\"]+)\"/)) {
			// window.location.hrefで示された移転先へ再接続
			autoDetect(RegExp.$1);
			return;
		}
		errorCallback(0);
	};
	gRequest = FoxAgeUtils.createHTTPRequest();
	gRequest.send(aURL, loadCallback, errorCallback);
	trace(browser.i18n.getMessage("checking") + ": " + gBoardItem.title);
	document.getElementById("throbber").src = "/icons/loading.png";
}

async function doTransfer() {
	var count = 0;
	var oldHost = document.getElementById("oldhost").value;
	var newHost = document.getElementById("newhost").value;
//	var https   = document.getElementById("https").checked;
	// 移転先ホスト名について最小限の検定
	if (!newHost || !/^\w+\..*\.\w+$/.test(newHost))
		return;
	// 移転先の板を追加
	var newBoardItem = FoxAgeUtils.createBoardItem(gBoardItem.id.replace(oldHost, newHost));
	newBoardItem.title  = gBoardItem.title;
	newBoardItem.status = gBoardItem.status;
	newBoardItem.unread = gBoardItem.unread;
	newBoardItem.skip   = gBoardItem.skip;
	newBoardItem.open   = gBoardItem.open;
	newBoardItem.maxRes = gBoardItem.maxRes;
	newBoardItem.error  = gBoardItem.error;
//	newBoardItem.https  = https;
	// エラーのステータスフラグは引き継がない
	if (newBoardItem.status & FoxAgeUtils.STATUS_ERROR)
		newBoardItem.status ^= FoxAgeUtils.STATUS_ERROR;
	// 移転先の板が存在しない場合に限り追加
	if (!FoxAgeSvc.getItem(newBoardItem.id)) {
		await FoxAgeSvc.insertItem(newBoardItem, gBoardItem);
		count++;
	}
	// Array.forEach内でのasync/awaitは全ループ同時に処理されるため、for-of文を使用
	let threadItems = FoxAgeSvc.getChildItems(gBoardItem.id);
	for (let threadItem of threadItems) {
		let newItemId = threadItem.id.replace(oldHost, newHost);
		let newThreadItem = FoxAgeUtils.createThreadItem(newItemId, newBoardItem, threadItem.title);
		newThreadItem.status  = threadItem.status;
		newThreadItem.readRes = threadItem.readRes;
		newThreadItem.lastRes = threadItem.lastRes;
		newThreadItem.exclude = threadItem.exclude;
		if (!FoxAgeSvc.getItem(newItemId)) {
			// 移転先のスレッドが存在しない場合に限り追加
			await FoxAgeSvc.insertItem(newThreadItem, null);
			count++;
		}
	}
	FoxAgeSvc.updateItemStats(newBoardItem);
	// メッセージ表示
	let msg = count > 0
	        ? browser.i18n.getMessage("add_result", count)
	        : browser.i18n.getMessage("already_added");
	FoxAgeSvc._notify("show-message", msg);
	// ツリー操作
	window.top.setTreeSelection(newBoardItem);
	window.top.showSubPane(newBoardItem);
	window.top.hideLayer();
}

function trace(aText) {
	gLogger.textContent = aText;
}

/*
function sleep(aMsec) {
	return new Promise((resolve, reject) => {
		setTimeout(resolve, aMsec);
	});
}
*/

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

