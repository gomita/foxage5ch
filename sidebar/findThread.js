////////////////////////////////////////////////////////////////////////////////
// global

var gBoardItem;
var gThreadItem;
var gDatList = [];
var gLogger;
var gRequest;

function init() {
	localize();
	captureKeyEvents();
	disableContextMenu();
	document.getElementById("backButton").onclick = window.top.hideLayer;
	document.getElementById("cancelButton").onclick = window.top.hideLayer;
	document.getElementById("addButton").onclick = onAddButtonClick;
	document.getElementById("searchkey").onchange = execSearch;
	document.getElementById("searchkey").onkeypress = onKeyPress;
	fitToContent();
	// URLの?以降からIDを取得
	var item = FoxAgeSvc.getItem(window.location.search.substr(1));
	if (!item)
		return;
	if (item.type == FoxAgeUtils.TYPE_BOARD) {
		// スレッド検索
		gThreadItem = null;
		gBoardItem = item;
		// 元スレ削除を非表示
		document.getElementById("deleteOrg").parentNode.style.display = "none";
		document.querySelector("h2").textContent = browser.i18n.getMessage("findThread");
	}
	else {
		// 次スレ検索
		gThreadItem = item;
		gBoardItem = FoxAgeSvc.getItem(gThreadItem.parent);
		if (!gBoardItem)
			return;
		document.querySelector("h2").textContent = browser.i18n.getMessage("findNext");
		document.getElementById("searchkey").value = gThreadItem.title;
	}
	document.getElementById("searchkey").select();
	gLogger = document.getElementById("logger");
	trace(gBoardItem.title);
	fitToContent();
	document.body.setAttribute("preload", "false");
	// subject.txt取得開始
	setTimeout(getSubjectTxt, 0);
}

function uninit() {
	if (gRequest) {
		gRequest.destroy();
		gRequest = null;
	}
	gBoardItem = null;
	gThreadItem = null;
	gDatList = null;
	gLogger = null;
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function getSubjectTxt() {
	var errorCallback = aHttpStatus => {
		document.getElementById("throbber").src = "";
		trace(browser.i18n.getMessage("error") + " (" + aHttpStatus + ")");
	};
	var loadCallback = aResponseText => {
		document.getElementById("throbber").src = "";
		trace(browser.i18n.getMessage("done"));
		aResponseText.split("\n").forEach(line => {
			// 1213352492.dat<>Mozilla Firefox Part85 (39) → %key%.dat<>%title% (nn)
			// 1212650212.cgi,ぷよぷよシリーズ！(72)       → %key%.cgi,%title%(nn)
			if (!/^(\d+)\.(?:dat<>|cgi,)(.+)\s*\((\d{1,4})\)$/.test(line))
				return;
			gDatList.push({
				id     : gBoardItem.id + "/" + RegExp.$1,
				title  : FoxAgeUtils.unescapeEntities(FoxAgeUtils.sanitizeTitle(RegExp.$2)),
				lastRes: parseInt(RegExp.$3, 10),
				created: parseInt(RegExp.$1, 10) * 1000 * 1000
			});
		});
		setTimeout(execSearch, 0);
	};
	var url = FoxAgeUtils.parseToURL(gBoardItem, FoxAgeSvc.getPref("https")) + "subject.txt";
	gRequest = FoxAgeUtils.createHTTPRequest();
	gRequest.send(url, loadCallback, errorCallback);
	trace(browser.i18n.getMessage("checking") + ": " + gBoardItem.title);
	document.getElementById("throbber").src = "/icons/loading.png";
}

function execSearch() {
	var resultList = document.getElementById("resultList");
	while (resultList.lastChild)
		resultList.removeChild(resultList.lastChild);
	var searchkey = document.getElementById("searchkey").value;
	if (!searchkey) {
		// すべてのスレを表示
		gDatList.map(dat => {
			resultList.appendChild(elementForDat(dat, false));
		});
	}
	else {
		// 検索キーにマッチしたスレのみ表示
		gDatList.filter(dat => {
			// 元スレは除外
			if (gThreadItem && gThreadItem.id == dat.id)
				return false;
			let [match, score] = compareTitles(searchkey, dat.title);
			// スコアが1以下の場合は除外
			if (score <= 1)
				return false;
			dat.match = match, dat.score = score;
			return true;
		})
		// スコアの降順に並べる
		.sort((dat1, dat2) => dat1.score < dat2.score).map(dat => {
			resultList.appendChild(elementForDat(dat, true));
		});
	}
}

function compareTitles(aOrgTitle, aNewTitle) {
	aOrgTitle = purifyTitle(aOrgTitle);
	aNewTitle = purifyTitle(aNewTitle);
	var finalMatch = "";
	var finalScore = 0;
	for (let i = 0; i < aOrgTitle.length; i++) {
		let firstChar = aOrgTitle.charAt(i);
		let firstPos = 0;
		while (firstPos != -1) {
			firstPos = aNewTitle.toUpperCase().indexOf(firstChar.toUpperCase(), firstPos);
			if (firstPos < 0)
				continue;
			let match = "";
			for (let j = i, k = firstPos; j < aOrgTitle.length, k < aNewTitle.length; j++, k++) {
				let orgChar = aOrgTitle.charAt(j);
				let newChar = aNewTitle.charAt(k);
				if (orgChar.toUpperCase() != newChar.toUpperCase())
					break;
				match = match.concat(newChar);
			}
			// マルチバイト文字はスコア2に換算する
			let score = match.replace(/[^\x20-\xFF]/g, "##").length;
			if (score > finalScore) {
				finalMatch = match;
				finalScore = score;
			}
			firstPos++;
		}
	}
	return [finalMatch, finalScore];
}

// 「スレッド Part 9」「スレ part99」などを削除する
function purifyTitle(aTitle) {
	aTitle = aTitle.replace(/(?:スレッド|スレ)\s*PART\s*\d+/i, "");
	return aTitle;
}

function elementForDat(dat, matching) {
	let elt = document.createElement("div");
	elt.className = "hbox";
	elt.innerHTML = `<input id="${dat.id}" type="checkbox" title="${dat.title}" lastRes="${dat.lastRes}">`
	              + `<label for="${dat.id}" title="${dat.title}">`
	              + (matching ? dat.title.replace(dat.match, `<strong>${dat.match}</strong>`) : dat.title)
	              + `</label>`;
	// すでに追加済みのスレッドはチェック済みかつ非活性にする
	if (FoxAgeSvc.getItem(dat.id)) {
		elt.firstChild.checked = true;
		elt.firstChild.disabled = true;
	}
	return elt;
}

function onAddButtonClick(event) {
	[...document.querySelectorAll("#resultList input")]
	.filter(checkbox => !checkbox.disabled && checkbox.checked)
	.map(async checkbox => {
		let itemId  = checkbox.id;
		let title   = checkbox.getAttribute("title");
		let lastRes = checkbox.getAttribute("lastRes");
		if (FoxAgeSvc.getItem(itemId))
			// すでに追加済み
			return;
		let item = FoxAgeUtils.createThreadItem(itemId, gBoardItem, title);
		item.lastRes = lastRes;
		item.status = FoxAgeUtils.STATUS_UPDATED;
		await FoxAgeSvc.insertItem(item, null);
		window.top.setTreeSelection(item);
	});
	// 元スレ削除
	if (document.getElementById("deleteOrg").checked)
		FoxAgeSvc.removeItem(gThreadItem);
	window.top.hideLayer();
}

function onKeyPress(event) {
	if (event.keyCode == event.DOM_VK_ESCAPE && event.target.value) {
		event.stopPropagation();
		event.target.value = "";
		execSearch();
	}
}

function trace(aText) {
	gLogger.textContent = aText;
}

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

