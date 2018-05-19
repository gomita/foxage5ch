////////////////////////////////////////////////////////////////////////////////
// global

var gItem;
var gChanged = false;

async function init() {
	await getService();
	localize();
	captureKeyEvents();
	disableContextMenu();
	document.getElementById("backButton").onclick = window.top.hideLayer;
	document.getElementById("cancelButton").onclick = window.top.hideLayer;
	document.getElementById("okButton").onclick = done;
	document.addEventListener("change", onChange);
	// URLの?以降からIDを取得
	gItem = FoxAgeSvc.getItem(window.location.search.substr(1));
	if (!gItem)
		return;
	buildUI();
	fitToContent();
	document.body.setAttribute("preload", "false");
}

function uninit() {
	document.removeEventListener("change", onChange);
	gItem = null;
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function onChange(event) {
	gChanged = true;
	console.log("change: " + event.target.id);	// #debug
}

function _element(aId) {
	return document.getElementById(aId);
}

function buildUI() {
	var typeBoard     = gItem.type == FoxAgeUtils.TYPE_BOARD;
	var typeThread    = gItem.type == FoxAgeUtils.TYPE_THREAD;
	var typeSeparator = gItem.type == FoxAgeUtils.TYPE_SEPARATOR;
	// タイトル
	_element("titleField").value = gItem.title;
	_element("titleField").select();
	// URL
	if (!typeSeparator) {
		var url = FoxAgeUtils.parseToURL(gItem, FoxAgeSvc.getPref("https"));
		_element("urlRow").hidden = false;
		_element("urlField").value = url;
	}
	if (!typeSeparator) {
		// 最大レス数
		_element("maxResRow").hidden = false;
		_element("maxResField").value = gItem.maxRes || 1000;
		_element("maxResField").disabled = typeThread;
	}
	// 最終チェック
	if (typeBoard) {
		_element("checkDateRow").hidden = false;
		var checkDate = gItem.checkDate
		              ? new Date(gItem.checkDate * 1000).toLocaleString() : "";
		_element("checkDateField").value = checkDate;
	}
	// スレ立て日時・既読レス数・最終レス数
	// 一部の2ch宣伝スレのDATキーがスレ立て日時でないことに注意
	if (typeThread) {
		var key = parseInt(FoxAgeUtils.threadKeyOfItem(gItem));
		var created = key < 9000000000 ? new Date(key * 1000).toLocaleString() : "";
		_element("createdRow").hidden = false;
		_element("readResRow").hidden = false;
		_element("lastResRow").hidden = false;
		_element("createdField").value = created;
		_element("readResField").value = gItem.readRes;
		_element("lastResField").value = gItem.lastRes;
	}
	// その他
	if (typeBoard) {
		_element("skipRow").hidden = false;
		_element("skipField").checked = !!gItem.skip;
	}
}

function done() {
	if (!gItem || !gChanged) {
		window.top.hideLayer();
		return;
	}
	var typeBoard  = gItem.type == FoxAgeUtils.TYPE_BOARD;
	var typeThread = gItem.type == FoxAgeUtils.TYPE_THREAD;
	// タイトル
	var title = _element("titleField").value;
	FoxAgeSvc.changeItemProperty(gItem, "title", title);
	if (typeBoard) {
		// skip
		var skip = _element("skipField").checked;
		FoxAgeSvc.changeItemProperty(gItem, "skip", skip || undefined);
		// maxRes
		var maxRes = _element("maxResField").value;
		maxRes = maxRes == 1000 ? undefined : maxRes;
		if (maxRes != gItem.maxRes) {
			// 板内の全スレッドのmaxResを更新する
			FoxAgeSvc.getChildItems(gItem.id).forEach(threadItem => {
				FoxAgeSvc.changeItemProperty(threadItem, "maxRes", maxRes);
			});
			FoxAgeSvc.changeItemProperty(gItem, "maxRes", maxRes);
			// スレッドエラー数(threadError)を更新する
			FoxAgeSvc.updateItemStats(threadItems[0]);
		}
	}
	FoxAgeSvc._notify("rebuild-tree");
	window.top.hideLayer();
}

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

