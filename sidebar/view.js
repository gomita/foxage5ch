////////////////////////////////////////////////////////////////////////////////
// global

var gStatusBar;
var gStatusTimer;
var gSearchTimer;
var gMainTree;
var gSubTree;
var gPopup;
var gDragOverString = "";
var gDragLeaveTimer = 0;

async function init() {
	await getService();
	localize();
	document.addEventListener("mousedown", onMouseDown);
	document.addEventListener("contextmenu", onContextMenu);
	document.addEventListener("auxclick", onAuxClick);
	document.addEventListener("click", onClick);
	document.addEventListener("keydown", onKeyDown);
	document.addEventListener("wheel", onWheel);
	document.addEventListener("dragstart", onDragStart);
	document.addEventListener("dragover", onDragOver);
	document.addEventListener("dragleave", onDragLeave);
	document.addEventListener("drop", onDrop);
	document.getElementById("searchbar").oninput = onSearch;
	browser.runtime.onMessage.addListener(onMessage);
	gStatusBar = document.getElementById("statusbar");
	gPopup     = document.getElementById("popup");
	gMainTree  = document.getElementById("mainTree");
	gSubTree   = document.getElementById("subTree");
	rebuildTree();
	if (FoxAgeSvc.getPref("treeMode") == 1) {
		var item = FoxAgeSvc.getItem(FoxAgeSvc.getPref("lastSubPane"));
		if (item) {
			showSubPane(item);
			setTreeSelection(item);
		}
	}
	// 更新チェック中、更新スレ開き中なら最初からボタンを押下状態にする
	if (FoxAgeSvc.isCheckingUpdates)
		onMessage({ topic: "check-start" });
	if (FoxAgeSvc.isOpeningUpdates)
		onMessage({ topic: "open-start" });
	if (window.location.hash == "#popup")
		document.documentElement.setAttribute("popup", "true");
}

function uninit() {
	// 本来はFirefoxアプリケーション終了時にFoxAgeSvc.destroyしたいが、
	// browser.runtime.onSuspendがFirefoxでは未実装のため、
	// 暫定策としてサイドバーを閉じたタイミングでデータ書き込みだけする
	FoxAgeSvc._flushData();
	browser.runtime.onMessage.removeListener(onMessage);
	document.removeEventListener("mousedown", onMouseDown);
	document.removeEventListener("contextmenu", onContextMenu);
	document.removeEventListener("auxclick", onAuxClick);
	document.removeEventListener("click", onClick);
	document.removeEventListener("keydown", onKeyDown);
	document.removeEventListener("wheel", onWheel);
	document.removeEventListener("dragstart", onDragStart);
	document.removeEventListener("dragover", onDragOver);
	document.removeEventListener("dragleave", onDragLeave);
	document.removeEventListener("drop", onDrop);
	document.getElementById("searchbar").oninput = null;
	clearTimeout(gStatusTimer);
	clearTimeout(gSearchTimer);
	gStatusBar = null;
	gPopup = null;
	gMainTree = null;
	gSubTree = null;
	FoxAgeSvc = null;
	FoxAgeUtils = null;
}

function onMouseDown(event) {
	// 中クリックによるページスクロールを抑止
	if (event.button == 1) {
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if (event.target.localName == "li")
		setTreeSelection(event.target);
}

function onContextMenu(event) {
	// 検索バーを除いて…
	if (event.target.localName == "input") {
		hidePopup();
		return;
	}
	// 右クリックメニューを抑止
	event.preventDefault();
	event.stopPropagation();
	// ツリーアイテム上に限り、ポップアップを表示
	if (event.target.localName == "li" || 
	    event.target.id == "subTitle" || event.target.id == "subTitleText")
		showPopup(event);
}

function onAuxClick(event) {
	if (event.button == 1)
		onClick(event);
}

async function onClick(event) {
	if (event.type == "click" && event.button != 0)
		return;
	let target = event.target;
	// ポップアップ
	if (!gPopup.hidden) {
		// ポップアップ枠や区切りをクリックしたとき、何もしない
		if (target == gPopup || target.localName == "hr")
			return;
		// この時点でポップアップは先に閉じる
		// ポップアップ外をクリックした場合もクリックを消費してポップアップを閉じる
		var item = FoxAgeSvc.getItem(gPopup.getAttribute("nodeId"));
		hidePopup();
		// コマンド実行
		if (event.button == 0 && target.id == "popup_checkUpdates") {
			FoxAgeSvc.checkUpdates(item.id);
		}
		else if (event.button == 0 && target.id == "popup_openUpdates") {
			FoxAgeSvc.openUpdates(item.id);
		}
		else if (target.id == "popup_open") {
			FoxAgeSvc.openItem(item, event.ctrlKey || event.shiftKey || event.button == 1);
		}
		else if (target.id == "popup_openInTab") {
			FoxAgeSvc.openItem(item, true);
		}
		else if (event.button == 0 && target.id == "popup_newSeparator") {
			doCommand("newSeparator", item);
		}
		else if (event.button == 0 && target.id == "popup_fetchTitle") {
			FoxAgeSvc.fetchTitle(item);
		}
		else if (event.button == 0 && target.id == "popup_findThread") {
			showLayer("sidebar/findThread.html?" + item.id);
		}
		else if (event.button == 0 && target.id == "popup_findNext") {
			showLayer("sidebar/findThread.html?" + item.id);
		}
		else if (event.button == 0 && target.id == "popup_transfer") {
			showLayer("sidebar/transfer.html?" + item.id);
		}
		else if (event.button == 0 && target.id == "popup_delete") {
			doCommand("delete", item);
		}
		else if (event.button == 0 && target.id == "popup_showInfo") {
			doCommand("showInfo", item);
		}
		return;
	}
	// ツールバーボタンのクリック
	if (event.button == 0 && target.id == "checkUpdatesButton") {
		if (target.getAttribute("checked") == "true")
			FoxAgeSvc.abortCheckUpdates();
		else
			FoxAgeSvc.checkUpdates("root");
	}
	else if (event.button == 0 && target.id == "openUpdatesButton") {
		if (target.getAttribute("checked") == "true")
			FoxAgeSvc.cancelOpenUpdates();
		else
			FoxAgeSvc.openUpdates("root");
	}
	else if (event.button == 0 && target.id == "subscribeButton") {
		showLayer("sidebar/subscribe.html");
	}
	else if (event.button == 0 && target.id == "toolsButton" ) {
		showLayer("sidebar/options.html");
	}
	// サブペーンタイトルのクリック
	else if (event.button == 0 && (target.id == "subTitle" || target.id == "subTitleText")) {
		var elt = document.getElementById(gSubTree.getAttribute("itemId"));
		setTreeSelection(elt, true);
	}
	// サブペーン閉じるボタンのクリック
	else if (event.button == 0 && target.id == "subTitleButton") {
		hideSubPane();
	}
	// カバー余白のクリック
	else if (target.id == "layer") {
		hideLayer();
	}
	// ツリーのクリック
	else if (target.localName == "li") {
		setTreeSelection(target);
		var item = FoxAgeSvc.getItem(target.id);
		var button = (event.ctrlKey || event.shiftKey) ? 1 : event.button;
		doCommand("open", item, button);
	}
}

function onKeyDown(event) {
	// ポップアップ上でEscキー押下
	if (!gPopup.hidden && event.key == "Escape") {
		event.preventDefault();
		hidePopup();
		return;
	}
	// 検索バー上
	if (event.target.id == "searchbar") {
		clearTimeout(gSearchTimer);
		// Escキー押下で検索終了
		if (event.key == "Escape") {
			event.preventDefault();
			event.target.value = "";
			rebuildTree();
		}
		// Enterキー押下で再検索
		else if (event.key == "Enter") {
			rebuildTree();
		}
		return;
	}
	// フォーカスしているツリーから選択している要素を取得
	// なぜかdocument.activeElementは<unavailable>になる
	var tree = document.querySelector("ul[focused]");
	if (!tree) return;
	var elt = tree.querySelector(".selected");
	if (!elt) return;
	var item = FoxAgeSvc.getItem(elt.id);
	if (!item) return;
	switch (event.key) {
		case "Enter"    : doCommand("open", item, event.ctrlKey || event.shiftKey ? 1:0); break;
		case "F2"       : doCommand("showInfo", item); break;
		case "Delete"   : doCommand("delete", item); break;
		case "ArrowUp"  : setTreeSelection(elt.previousSibling, true); break;
		case "ArrowDown": setTreeSelection(elt.nextSibling, true); break;
		default: 
	}
}

function onWheel(event) {
	// 拡大／縮小を抑止
	if (event.ctrlKey || event.metaKey)
		event.preventDefault();
}

function onDragStart(event) {
	if (event.target.localName != "li")
		return;
	var dt = event.dataTransfer;
	var tree = event.target.parentNode;
	var item = FoxAgeSvc.getItem(event.target.id);
	if (item.type != FoxAgeUtils.TYPE_SEPARATOR) {
		// 板またはスレをドラッグ開始時、URLを転送
		var url = FoxAgeUtils.parseToURL(item, FoxAgeSvc.getPref("http"));
		dt.setData("text/x-moz-url", url + "\n" + item.title);
		dt.setData("text/unicode", url);
	}
	if (item.type != FoxAgeUtils.TYPE_THREAD && !document.getElementById("searchbar").value) {
		// 板または区切りをドラッグ開始時、アイテムIDを転送（ただし検索中は除く）
		dt.setData(FoxAgeUtils.DROP_TYPE, item.id);
	}
	dt.dropEffect = "move";
}

// dragover/dropイベント発生元の要素aTargetに対するドロップが可能か
function canDrop(aTarget, aBeforeAfter) {
	// ２ペーンの場合、メインツリーに対するドロップのみ許可
	if (FoxAgeSvc.getPref("treeMode") != 0) {
		return (aTarget.parentNode == gMainTree);
	}
	// ツリー表示の場合、板とスレの間、スレとスレの間へのドロップを非許可
	let type = aTarget.getAttribute("type");
	let prevType = "", nextType = "";
	if (aTarget.previousSibling)
		prevType = aTarget.previousSibling.getAttribute("type");
	if (aTarget.nextSibling)
		nextType = aTarget.nextSibling.getAttribute("type");
	if ((aBeforeAfter == -1 && type == "thread" && prevType == "board" ) || 
	    (aBeforeAfter ==  1 && type == "board"  && nextType == "thread") || 
	    (aBeforeAfter == -1 && type == "thread" && prevType == "thread") || 
	    (aBeforeAfter ==  1 && type == "thread" && nextType == "thread")) {
		return false;
	}
	return true;
}

function onDragOver(event) {
	if (gDragLeaveTimer)
		clearTimeout(gDragLeaveTimer);
	event.preventDefault();
	if (event.target.localName != "li")
		return;
	let rect = event.target.getBoundingClientRect();
	let beforeAfter = event.clientY < rect.top + rect.height / 2 ? -1 : 1;
	// 過剰なdragover処理を避けるため、文字列「drop_{before|after}:<id>」が前回と一致している場合は何もしない
	let str = "drop_" + (beforeAfter < 0 ? "before" : "after") + ":" + event.target.id;
	if (gDragOverString == str)
		return;
	gDragOverString = str;
	// ドロップインジケータの表示／非表示
	var dropline = document.getElementById("dropline");
	if (canDrop(event.target, beforeAfter)) {
		dropline.hidden = false;
		dropline.style.top = (beforeAfter < 0 ? rect.top : rect.top + rect.height) - 2 + "px";
	}
	else {
		dropline.hidden = true;
	}
	console.log(gDragOverString);	// #debug
}

function onDragLeave(event) {
	gDragLeaveTimer = setTimeout(() => {
		document.getElementById("dropline").hidden = true;
		gDragOverString = "";
	}, 10);
}

async function onDrop(event) {
	document.getElementById("dropline").hidden = true;
	event.preventDefault();
	var dt = event.dataTransfer;
	// 板または区切りをドロップ時、アイテムを移動
	var itemId = dt.getData(FoxAgeUtils.DROP_TYPE);
	if (itemId) {
		// beforeAfterの計算は面倒なので_lastDragOver文字列から採取
		if (!/^drop_(\w+):/.test(gDragOverString))
			return;
		let beforeAfter = RegExp.$1 == "before" ? -1 : 1;
		gDragOverString = "";
		if (!canDrop(event.target, beforeAfter))
			return;
		let dragItem = FoxAgeSvc.getItem(itemId);
		let dropItem = FoxAgeSvc.getItem(event.target.id);
		await FoxAgeSvc.moveItem(dragItem, dropItem, beforeAfter);
		setTreeSelection(dragItem, true);
		return;
	}
	// URL（リンクやfavicon）のドロップ時、板やスレを追加
	// ブラウザタブのドロップ時、板やスレを追加
	// 文字列のドロップ時、板やスレを追加
	var url = dt.getData("text/x-moz-url") || 
	          dt.getData("text/x-moz-text-internal") ||
	          dt.getData("text/unicode");
	if (!url || !url.startsWith("http"))
		return;
	url = url.split("\n")[0];
	doCommand("subscribe", null, url);
}

function onSearch(event) {
	// #debug-begin
	if (event.target.value == "xuldev") {
		document.getElementById("checkUpdatesButton").setAttribute("checked", "true");
		var items = FoxAgeSvc.getChildItems("root").filter(item => item.type == FoxAgeUtils.TYPE_BOARD);
		FoxAgeSvc._addStatusFlag(items[1], FoxAgeUtils.STATUS_CHECKING);
		FoxAgeSvc._notify("rebuild-tree");
		FoxAgeSvc._notify("show-message", browser.i18n.getMessage("checking") + ": " + items[1].title + "...");
		event.target.value = "";
		event.target.blur();
		// setTreeSelection(items[0], true);
		return;
	}
	// #debug-end
	clearTimeout(gSearchTimer);
	gSearchTimer = setTimeout(rebuildTree, 500);
}

function onMessage(request, sender, sendResponse) {
	switch (request.topic) {
		// メッセージ表示
		case "show-message": 
			console.log("show message: " + request.value || "\u00a0");	// #debug
			gStatusBar.setAttribute("fade", "in");
			gStatusBar.textContent = request.value || "\u00a0";
			// 末尾が...のメッセージは自動消去しない
			if (request.value.endsWith("..."))
				break;
			clearTimeout(gStatusTimer);
			// 3秒後に自動消去
			gStatusTimer = setTimeout(() => { 
				gStatusBar.setAttribute("fade", "out");
			}, 3000);
			break;
		// ツリー再描画
		case "rebuild-tree": 
			rebuildTree(request.value);
			break;
		// サイドバー再読み込み
		case "reload-data": 
			window.location.reload();
			break;
		// 更新チェック：開始
		case "check-start": 
			document.getElementById("checkUpdatesButton").setAttribute("checked", "true");
			document.getElementById("popup_checkUpdates").setAttribute("disabled", "true");
			break;
		// 更新チェック：終了
		case "check-stop": 
			document.getElementById("checkUpdatesButton").removeAttribute("checked");
			document.getElementById("popup_checkUpdates").removeAttribute("disabled");
			break;
		// 更新されたスレッドを開く：開始
		case "open-start": 
			document.getElementById("openUpdatesButton").setAttribute("checked", "true");
			break;
		// 更新されたスレッドを開く終了
		case "open-stop": 
			document.getElementById("openUpdatesButton").removeAttribute("checked");
			break;
		default: 
			console.error("unknown topic: " + request.topic);	// #debug
	}
	if (sendResponse)
		sendResponse({ topic: request.topic });
}

////////////////////////////////////////////////////////////////////////////////
// コマンド

async function doCommand(aCommand, aItem, aOption) {
	switch (aCommand) {
		// @param aOption クリックしたボタン(0,1,2)
		case "open": 
			if (aItem.type == FoxAgeUtils.TYPE_BOARD) {
				if (aOption == 0) {
					// 板の左クリック
					if (FoxAgeSvc.getPref("treeMode") == 0) {
						// フォルダの開閉
						aItem.open = !aItem.open;
						rebuildTree();
					}
					else {
						// スレッド一覧表示
						showSubPane(aItem);
					}
				}
				else if (aOption == 1) {
					// 板の中クリック
					FoxAgeSvc.openItem(aItem, true);
				}
			}
			else if (aItem.type == FoxAgeUtils.TYPE_THREAD) {
				let inNewTab, active;
				// スレの左クリック
				if (aOption == 0) {
					let clickBehavior = FoxAgeSvc.getPref("clickBehavior");
					inNewTab = clickBehavior >= 1;
					active = clickBehavior == 2;
				}
				// スレの中クリック
				else if (aOption == 1) {
					inNewTab = true;
					active = false;	// 決め打ちでいいか？
				}
				FoxAgeSvc.openItem(aItem, inNewTab, active);
			}
			break;
		// @param aOption URL
		case "subscribe": 
			var [boardItem, threadItem] = await FoxAgeSvc.subscribe(aOption);
			if (boardItem) {
				showSubPane(boardItem);
				setTreeSelection(boardItem, true);
			}
			if (threadItem)
				setTreeSelection(threadItem, true);
			break;
		case "newSeparator": 
			var newItem = FoxAgeUtils.createSeparatorItem();
			await FoxAgeSvc.insertItem(newItem, aItem);
			setTreeSelection(newItem);
			break;
		case "delete": 
			if (!window.confirm(browser.i18n.getMessage("delete_confirm")))
				return;
			FoxAgeSvc.removeItem(aItem);
			if (gSubTree.getAttribute("itemId") == aItem.id)
				hideSubPane();
			break;
		case "showInfo": 
			showLayer("sidebar/showInfo.html?" + aItem.id);
			break;
	}
}

////////////////////////////////////////////////////////////////////////////////
// ツリー

function elementForItem(item) {
	var elt = document.createElement("li");
	elt.id = item.id;
	// 形式
	switch (item.type) {
		case FoxAgeUtils.TYPE_BOARD    : elt.setAttribute("type", "board"); break;
		case FoxAgeUtils.TYPE_THREAD   : elt.setAttribute("type", "thread"); break;
		case FoxAgeUtils.TYPE_SEPARATOR: elt.setAttribute("type", "separator"); break;
	}
	// BBS
	if (item.type == FoxAgeUtils.TYPE_BOARD) {
		switch (item.bbs) {
			case FoxAgeUtils.BBS_5CH  : elt.classList.add("bbs5ch"); break;
			case FoxAgeUtils.BBS_PINK : elt.classList.add("pink"); break;
			case FoxAgeUtils.BBS_MACHI: elt.classList.add("machi"); break;
			case FoxAgeUtils.BBS_JBBS : elt.classList.add("jbbs"); break;
			default: elt.classList.add("unknown"); break;
		}
	}
	// ステータス
	if (item.status & FoxAgeUtils.STATUS_CHECKING)
		elt.classList.add("checking");
	if (item.status & FoxAgeUtils.STATUS_UPDATED)
		elt.classList.add("updated");
	if (item.status & FoxAgeUtils.STATUS_DATOUT)
		elt.classList.add("datout");
	if (item.status & FoxAgeUtils.STATUS_ERROR)
		elt.classList.add("error");
	if (item.open)
		elt.classList.add("open");
	if (item.skip)
		elt.classList.add("skip");
	if (item.exclude)
		elt.classList.add("exclude");
	// タイトル
	var title = item.title;
	if (item.type == FoxAgeUtils.TYPE_BOARD) {
		// 未読ありの板：「タイトル (N)」
		if (item.unread > 0)
			title = `${title} (${item.unread})`;
		var url = FoxAgeUtils.parseToURL(item, FoxAgeSvc.getPref("https"));
		elt.setAttribute("title", item.title + "\u000a" + url);
	}
	else if (item.type == FoxAgeUtils.TYPE_THREAD) {
		// 未読ありのスレ：「(N) タイトル」
		if (item.lastRes - item.readRes > 0)
			title = `(${item.lastRes - item.readRes}) ${title}`;
		if (item.lastRes >= (item.maxRes || 1000))
			elt.classList.add("over1000");
		elt.setAttribute("title", item.title);
	}
	else if (item.type == FoxAgeUtils.TYPE_SEPARATOR) {
		// タイトルなしの区切りでCSSの:after疑似要素を適用するため&nbsp;を使用
		if (!title) {
			title = "\u00a0";
			elt.classList.add("notitle");
		}
	}
	elt.setAttribute("draggable", "true");
	elt.appendChild(document.createTextNode(title));
	return elt;
}

function rebuildTree(aItemId) {
	if (!aItemId) {
		while (gMainTree.lastChild)
			gMainTree.removeChild(gMainTree.lastChild);
		// 検索
		let key = document.getElementById("searchbar").value;
		if (key) {
			console.log("rebuild tree: " + key);	// #debug
			hideSubPane();
			FoxAgeSvc.queryItems(key).forEach(item => {
				gMainTree.appendChild(elementForItem(item));
			});
			return;
		}
		// メインツリー全体を再描画
		console.log("rebuild tree: *");	// #debug
		// 選択済みのアイテムのIDを保持
		var sel = gMainTree.querySelector(".selected");
		var selId = sel ? sel.id : null;
		while (gMainTree.lastChild)
			gMainTree.removeChild(gMainTree.lastChild);
		var treeMode = FoxAgeSvc.getPref("treeMode");
		FoxAgeSvc.getChildItems("root").forEach(item => {
			gMainTree.appendChild(elementForItem(item));
			if (treeMode == 0 && item.type == FoxAgeUtils.TYPE_BOARD && item.open) {
				FoxAgeSvc.getChildItems(item.id).forEach(item => {
					gMainTree.appendChild(elementForItem(item));
				});
			}
		});
		if (selId)
			setTreeSelection(selId);
		// サブツリーが表示されていれば、サブツリーを再表示する
		if (!gSubTree.hidden)
			showSubPane(FoxAgeSvc.getItem(gSubTree.getAttribute("itemId")));
	}
	else {
		// aItemIdで指定されたアイテムのみ再描画
		console.log("rebuild tree: " + aItemId);	// #debug
		// メインツリー／サブツリーによらず有効
		var oldElt = document.getElementById(aItemId);
		if (!oldElt)
			return;
		// 一時的に付与されたクラスを引き継ぐ
		var selected = oldElt.classList.contains("selected");
		var newElt = elementForItem(FoxAgeSvc.getItem(aItemId));
		oldElt.parentNode.replaceChild(newElt, oldElt);
		if (selected)
			newElt.classList.add("selected");
		// サブツリーにaItemIdで指定された板のスレ一覧が表示されていれば、サブツリーを再表示する
		if (!gSubTree.hidden && gSubTree.getAttribute("itemId") == aItemId)
			showSubPane(FoxAgeSvc.getItem(aItemId));
	}
}

function showSubPane(aBoardItem) {
	if (FoxAgeSvc.getPref("treeMode") != 1)
		return;
	// 板タイトルを表示
	var url = FoxAgeUtils.parseToURL(aBoardItem, FoxAgeSvc.getPref("https"));
	var subTitle = document.getElementById("subTitle");
	subTitle.style.display = "";
	var subTitleText = document.getElementById("subTitleText");
	subTitleText.textContent = aBoardItem.title;
	subTitle.setAttribute("title", aBoardItem.title + "\n" + url);
	// サブツリーを表示
	gSubTree.hidden = false;
	gSubTree.setAttribute("itemId", aBoardItem.id);
	while (gSubTree.lastChild)
		gSubTree.removeChild(gSubTree.lastChild);
	FoxAgeSvc.getChildItems(aBoardItem.id).forEach(item => {
		gSubTree.appendChild(elementForItem(item));
	});
	// 前回開いたサブペーンを記憶
	FoxAgeSvc.setPref("lastSubPane", aBoardItem.id);
}

function hideSubPane() {
	var subTitle = document.getElementById("subTitle");
	subTitle.style.display = "none";
	while (gSubTree.lastChild)
		gSubTree.removeChild(gSubTree.lastChild);
	gSubTree.hidden = true;
	// 前回開いたサブペーンを忘却
	FoxAgeSvc.setPref("lastSubPane", "");
}

// @param aArgument アイテムID、アイテム、li要素のいずれか
// @param aAutoScroll nsITreeBoxObject::ensureRowIsVisible相当
function setTreeSelection(aArgument, aAutoScroll) {
	if (!aArgument)
		return;
	var elt = aArgument instanceof HTMLLIElement ? aArgument : 
	          document.getElementById(aArgument.id || aArgument);
	if (!elt)
		return;
	var tree = elt.parentNode;
	tree.setAttribute("focused", "true");
	(tree == gMainTree ? gSubTree : gMainTree).removeAttribute("focused");
	var oldElt = tree.querySelector("li.selected");
	if (oldElt)
		oldElt.classList.remove("selected");
	elt.classList.add("selected", "true");
	elt.focus({ preventScroll: true });
	if (aAutoScroll)
		elt.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

////////////////////////////////////////////////////////////////////////////////
// レイヤー

function showLayer(aURL) {
	var layer = document.getElementById("layer");
	layer.hidden = false;
	layer.firstChild.src = browser.runtime.getURL(aURL);
}

function hideLayer() {
	var layer = document.getElementById("layer");
	layer.firstChild.src = "about:blank";
	layer.hidden = true;
}

////////////////////////////////////////////////////////////////////////////////
// ポップアップ

function showPopup(event) {
	if (!gPopup.hidden)
		hidePopup();
	var bodyWidth  = document.body.clientWidth;
	var bodyHeight = document.body.clientHeight;
	// ポップアップを表示
	var nodeId = event.target.id.startsWith("subTitle")
	           ? gSubTree.getAttribute("itemId") : event.target.id;
	var nodeType = FoxAgeSvc.getItem(nodeId).type;
	// 区切りに対するラベルの変更
	var labels = nodeType == FoxAgeUtils.TYPE_BOARD ? 
	             ["checkUpdates", "openUpdates"] : ["checkUpdatesSep", "openUpdatesSep"];
	labels = labels.map(label => browser.i18n.getMessage(label));
	document.getElementById("popup_checkUpdates").textContent = labels[0];
	document.getElementById("popup_openUpdates").textContent  = labels[1];
	// ポップアップを表示
	gPopup.hidden = false;
	gPopup.setAttribute("nodeId", nodeId);
	gPopup.setAttribute("nodeType", nodeType);
	var x = Math.min(event.clientX, bodyWidth - gPopup.clientWidth - 6);
	var y = Math.min(event.clientY, bodyHeight - gPopup.clientHeight - 6);
	gPopup.style = `top: ${y}px; left: ${x}px;`;
	window.addEventListener("blur", hidePopup, { once: "true" });
}

function hidePopup() {
//	[...gPopup.childNodes].filter(elt => !(elt instanceof Text)).forEach(elt => elt.style.display = "");
	window.removeEventListener("blur", hidePopup);
	gPopup.removeAttribute("nodeId");
	gPopup.removeAttribute("nodeType");
	gPopup.hidden = true;
}

window.addEventListener("load", init, { once: true });
window.addEventListener("pagehide", uninit, { once: true });

