////////////////////////////////////////////////////////////////////////////////
// global

// #debug-begin
function LOG(aMessage) {
	console.log("FoxAge> "+ aMessage);
}
// #debug-end

// JSONデータのキー
const DATA_KEY_PREFS = "foxage-prefs";
const DATA_KEY_ITEMS = "foxage-items";
// 遅延書き込みの待ち時間
const FLUSH_DELAY = 10 * 1000;	// msec
// 更新チェックで次のキューへ行く待ち時間
const CHECK_INTERVAL = 100;	// msec
// 更新チェック抑止時間
const LOCK_TIME = 60;	// sec

////////////////////////////////////////////////////////////////////////////////
// FoxAgeSvc

var FoxAgeSvc = {

	_init: async function() {
		LOG("service init");	// #debug
		await this._readData();
		// データ読み込み完了後にツリー再描画
		this._notify("rebuild-tree");
		browser.browserAction.onClicked.addListener(this._handleBrowserAction);
//		browser.runtime.onSuspend.addListener(this._destroy);
//		browser.storage.onChanged.addListener(function(changes, area) {
//			LOG("storage." + area + " changed: \n" + changes.toSource());
//		});
	},

	_destroy: function() {
		LOG("service destroy");	// #debug
		this.abortCheckUpdates();
		this.cancelOpenUpdates();
//		browser.runtime.onSuspend.removeListener(this._destroy);
		browser.browserAction.onClicked.removeListener(this._handleBrowserAction);
		if (this._flushTimer) {
			this._flushData();
			this._flushTimer.cancel();
			this._flushTimer = null;
		}
		this._defaultPrefs = null;
		this._userPrefs = null;
		this._indexForItemId = null;
		this._allItems = null;
	},

	////////////////////////////////////////////////////////////////////////////////
	// 設定値

	_defaultPrefs: null,
	_userPrefs: null,

	getPref: function(aKey) {
		return aKey in this._userPrefs ? this._userPrefs[aKey] : this._defaultPrefs[aKey];
	},

	setPref: function(aKey, aValue) {
		if (this._defaultPrefs[aKey] == aValue)
			delete this._userPrefs[aKey];
		else
			this._userPrefs[aKey] = aValue;
		this._flushDataWithDelay();
	},

	////////////////////////////////////////////////////////////////////////////////
	// データ管理

	_readData: async function() {
		if (!this._defaultPrefs) {
			// デフォルト設定値読み込み
			let response = await fetch(browser.extension.getURL("/defaults/prefs.json"));
			let text = await response.text();
			this._defaultPrefs = JSON.parse(text);
		}
		return browser.storage.local.get().then(async data => {
			// ユーザー設定値読み込み
			if (DATA_KEY_PREFS in data)
				this._userPrefs = data[DATA_KEY_PREFS];
			else
				this._userPrefs = {};
			if (DATA_KEY_ITEMS in data) {
				// 既存データ読み込み
				this._allItems = data[DATA_KEY_ITEMS];
				this._updateIndexForItemId();
			}
			else {
				// 初期データ読み込み
				let response = await fetch(browser.extension.getURL("/defaults/items.json"));
				let text = await response.text();
				this._allItems = JSON.parse(text);
				this._updateIndexForItemId();
			}
		}, () => {
			console.error("failed to get local storage");
		});
	},

	_flushTimer: null,

	_flushDataWithDelay: function() {
		// タイマー作動中は何もしない
		if (this._flushTimer)
			return;
		this._flushTimer = setTimeout(() => {
			this._flushTimer = null;
			this._flushData();
		}, FLUSH_DELAY);
	},

	_flushData: function() {
		let data = {};
		data[DATA_KEY_PREFS] = this._userPrefs;
		data[DATA_KEY_ITEMS] = this._allItems;
		return browser.storage.local.set(data).then(() => {
			LOG("flush data");	// #debug
		});
	},

	backupData: async function() {
		let data = {};
		data[DATA_KEY_PREFS] = this._userPrefs;
		data[DATA_KEY_ITEMS] = this._allItems;
		data = JSON.stringify(data, null, "\t");
		let url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
		let dt = new Date();
		let ymd = [
			dt.getFullYear(),
			(dt.getMonth() + 1).toString().padStart(2, "0"),
			dt.getDate().toString().padStart(2, "0")
		].join("-");
		let filename = `foxage5ch-${ymd}.json`;
		let id = await browser.downloads.download({ url, filename, saveAs: true });
		browser.downloads.onChanged.addListener(function clear(delta) {
			if (delta.id == id && delta.state.current == "complete") {
				URL.revokeObjectURL(url);
				browser.downloads.onChanged.removeListener(clear);
			}
		});
	},

	restoreData: async function(aData) {
		var data = {};
		// {foxage-prefs:{},foxage-items:[]} （FoxAge5ch形式）データの復元
		if (DATA_KEY_PREFS in aData && DATA_KEY_ITEMS in aData) {
			data = aData;
		}
		// [{id:"root"},...] （FoxAge2ch形式）データの移行
		else if (aData.length > 0 && aData[0].id == "root") {
			data[DATA_KEY_PREFS] = this._userPrefs;
			data[DATA_KEY_ITEMS] = aData;
		}
		else
			return;
		// .2ch.net/ => .5ch.net/置換
		data[DATA_KEY_ITEMS].forEach(item => {
			item.id = item.id.replace(".2ch.net/", ".5ch.net/");
			if (item.type == FoxAgeUtils.TYPE_THREAD)
				item.parent = item.parent.replace(".2ch.net/", ".5ch.net/");
		});
		await browser.storage.local.set(data);
		await this._readData();
		this._notify("reload-data");
	},

	////////////////////////////////////////////////////////////////////////////////
	// データ操作

	// すべてのアイテムの配列
	_allItems: null,

	// 指定したアイテムIDに対応するアイテムを取得する
	getItem: function(aItemId) {
		if (aItemId in this._indexForItemId) {
			var item = this._allItems[this._indexForItemId[aItemId]];
			console.assert(item.id == aItemId, "_indexForItemId");	// #debug
			return item;
		}
		return null;
	},

	// getItemを高速化するためのハッシュ
	// キー: アイテムid, 値: _allItems中の配列番号
	_indexForItemId: null,

	// _indexForItemIdを更新する
	// _allItems配列に対して以下の操作を行った場合、このメソッドを呼び出す必要がある
	_updateIndexForItemId: function() {
		this._indexForItemId = {};
		for (var i = 0; i < this._allItems.length; i++) {
			this._indexForItemId[this._allItems[i].id] = i;
		}
	},

	// 指定したアイテムIDを親とするすべてのアイテムの配列を取得する
	getChildItems: function(aParentId) {
		return this._allItems.filter(item => item.parent == aParentId);
	},

	// 新たに生成したアイテムを追加する
	// ツリー再描画完了後にPromiseを返す
	insertItem: function(aNewItem, aRefItem) {
		// 既存IDの追加を防止
		if (this.getItem(aNewItem.id)) {
			console.error("already exists: " + aNewItem.id);
			throw new Error("already exists");
		}
		var updatedThread = (aNewItem.type == FoxAgeUtils.TYPE_THREAD && 
		                     aNewItem.status & FoxAgeUtils.STATUS_UPDATED);
		if (updatedThread)
			// 未読スレは配列の先頭へ追加
			this._allItems.splice(1, 0, aNewItem);
		else if (aRefItem)
			// 指定した位置へ追加
			this._allItems.splice(this._allItems.indexOf(aRefItem), 0, aNewItem);
		else
			// 配列の末尾へ追加
			this._allItems.push(aNewItem);
		this._updateIndexForItemId();
		if (updatedThread)
			this._updateBoardStats(this.getItem(aNewItem.parent));
		this._flushDataWithDelay();
		return this._notify("rebuild-tree");
	},

	// 指定したアイテムaItemをaRefItemの位置へ移動する
	// aBeforeAfterが負の場合は直前へ、正の場合は直後へ移動する
	// ツリー再描画後にPromiseを返す
	moveItem: function(aItem, aRefItem, aBeforeAfter) {
		if (aItem.id == aRefItem.id)
			return;
		// aItemを配列から削除
		var sourceIndex = this._allItems.indexOf(aItem);
		var removedItems = this._allItems.splice(sourceIndex, 1);
		// aItemをaRefItemの位置へ挿入
		var targetIndex = this._allItems.indexOf(aRefItem);
		if (aBeforeAfter > 0)
			targetIndex++;
		this._allItems.splice(targetIndex, 0, removedItems[0]);
		this._updateIndexForItemId();
		this._flushDataWithDelay();
		return this._notify("rebuild-tree");
	},

	// 指定したアイテムを削除する
	// ツリー再描画後にPromiseを返す
	removeItem: function(aItem) {
		var removedCount = 0;
		var removedItems = [aItem];
		if (aItem.type == FoxAgeUtils.TYPE_BOARD)
			removedItems = removedItems.concat(this.getChildItems(aItem.id));
		// 後から順番に削除する
		removedItems.reverse().forEach(removedItem => {
			// LOG("deleted: " + removedItem.title);	// #debug
			var index = this._allItems.indexOf(removedItem);
			this._allItems.splice(index, 1);
			removedCount++;
		});
		this._updateIndexForItemId();
		if (aItem.type == FoxAgeUtils.TYPE_THREAD)
			// スレを削除した場合、親の板の未読スレッド数を更新する
			this._updateBoardStats(this.getItem(aItem.parent));
		else if (aItem.type == FoxAgeUtils.TYPE_BOARD)
			// 板を削除した場合、ルートのdat落ちスレッド数を更新する
			this._updateRootStats();
		this._flushDataWithDelay();
		this._notify("show-message", browser.i18n.getMessage("delete_result", removedCount));
		return this._notify("rebuild-tree");
	},

	// 指定したアイテム (板またはスレッド) をブラウザで開く
	openItem: async function(aItem, aInNewTab, aActive = true) {
		var url = FoxAgeUtils.parseToURL(aItem, this.getPref("https"));
		// タブ再利用マッチング用
		var urlPattern = url;
		if (aItem.type == FoxAgeUtils.TYPE_THREAD) {
			// upwardMarginが負の場合、すべてのレスを表示
			if (this.getPref("upwardMargin") >= 0) {
				if (!aItem.lastRes)
					// 初回: 最新50レス
					url += "l50";
				else {
					// 2回目以降: readRes - さかのぼり表示差分 ～ lastRes
					var startRes = (aItem.readRes || 0) - this.getPref("upwardMargin") + 1;
					if (startRes < 1)
						// さかのぼり表示で開始スレ番号が負になるのを防ぐ
						startRes = 1;
					if (startRes > aItem.lastRes)
						// upwardMarginが0で未読レスが無い場合、startRes > lastResとなるのを防ぐ
						startRes = aItem.lastRes;
					url += startRes.toString() + "-" + aItem.lastRes.toString();
					if (startRes > 1 && this.getItem(aItem.parent).bbs != FoxAgeUtils.BBS_MACHI)
						// 1表示を抑止
						url += "n";
				}
			}
			urlPattern += "*";
		}
		var tabs = await browser.tabs.query({ url: urlPattern, currentWindow: true });
		if (tabs.length > 0) {
			// タブの再利用
			// 再利用可能なタブが複数ある場合、先頭でよいかは検討の余地あり
			// スレでURLが完全に一致する場合、タブをアクティブにするだけ
			if (aItem.type == FoxAgeUtils.TYPE_THREAD && tabs[0].url == url)
				await browser.tabs.update(tabs[0].id, { active: true });
			else
				await browser.tabs.update(tabs[0].id, { url, active: true });
		}
		else {
			if (aInNewTab)
				await browser.tabs.create({ url, active: aActive });
			else
				await browser.tabs.update({ url });
		}
		if (aItem.type == FoxAgeUtils.TYPE_THREAD) {
			if (aItem.status & FoxAgeUtils.STATUS_UPDATED) {
				// スレッドのステータスを既読へ変更
				this._removeStatusFlag(aItem, FoxAgeUtils.STATUS_UPDATED);
				this.changeItemProperty(aItem, "readRes", aItem.lastRes);
				// 板の未読スレッド数・ステータスを変更
				this._updateBoardStats(this.getItem(aItem.parent));
				this._notify("rebuild-tree", aItem.id);
				this._notify("rebuild-tree", aItem.parent);
			}
		}
	},

	// aKeyにマッチしたアイテムの配列を返す
	queryItems: function(aKey) {
		// フィルター検索
		if (aKey.startsWith("filter:")) {
			let items = [];
			if (aKey.indexOf("datout") > 0) {
				items = items.concat(this._allItems.filter(item => {
					return item.type == FoxAgeUtils.TYPE_THREAD && 
					       item.status & FoxAgeUtils.STATUS_DATOUT;
				}));
			}
			if (aKey.indexOf("1000") > 0) {
				items = items.concat(this._allItems.filter(item => {
					return item.type == FoxAgeUtils.TYPE_THREAD && 
					       this.getItem(item.parent) && 
					       item.lastRes >= this.getItem(item.parent).maxRes;
				}));
			}
			return items;
		}
		// 正規表現によるタイトル検索
		else {
			let pattern = new RegExp(aKey, "i");
			return this._allItems.filter(item => item.id != "root" && pattern.test(item.title));
		}
	},

	// アイテムのプロパティを変更する
	changeItemProperty: function(aItem, aProperty, aValue) {
		if (aValue === undefined)
			delete aItem[aProperty];
		else
			aItem[aProperty] = aValue;
		this._flushDataWithDelay();
	},

	_addStatusFlag: function(aItem, aFlag) {
		if (aItem.status & aFlag)
			return;
		this.changeItemProperty(aItem, "status", aItem.status | aFlag);
	},

	_removeStatusFlag: function(aItem, aFlag) {
		if (aItem.status & aFlag)
			this.changeItemProperty(aItem, "status", aItem.status ^ aFlag);
	},

	// アイテムに関連する統計データを更新する
	updateItemStats: function(aItem) {
		if (aItem.type == FoxAgeUtils.TYPE_THREAD)
			this._updateBoardStats(this.getItem(aItem.parent));
		else if (aItem.type == FoxAgeUtils.TYPE_BOARD)
			this._updateRootStats();
	},

	// 板の未読スレッド数(unread)・dat落ちスレッド数(error)・ステータスを更新する
	// @param aBoardItem 板のアイテム
	_updateBoardStats: function(aBoardItem) {
		var threadItems = this.getChildItems(aBoardItem.id);
		var unread = 0, error = 0;
		threadItems.forEach(threadItem => {
			if (threadItem.status & FoxAgeUtils.STATUS_UPDATED)
				unread++;
			// 未読かつdat落ちというステータスがありえるため「else if」にしない
			if (!threadItem.exclude && 
			    (threadItem.status & FoxAgeUtils.STATUS_DATOUT || threadItem.lastRes >= (threadItem.maxRes || 1000)))
				error++;
		});
		if (unread > 0)
			this._addStatusFlag(aBoardItem, FoxAgeUtils.STATUS_UPDATED);
		else
			this._removeStatusFlag(aBoardItem, FoxAgeUtils.STATUS_UPDATED);
		this.changeItemProperty(aBoardItem, "unread", unread == 0 ? undefined : unread);
		if (error != (aBoardItem.error || 0)) {
			// 板のerrorプロパティに変化あり
			this.changeItemProperty(aBoardItem, "error", error == 0 ? undefined : error);
			this._updateRootStats();
		}
	},

	// ルートの板エラー数(boardError)・スレッドエラー数(threadError)を更新する
	_updateRootStats: function() {
		var boardError = 0, threadError = 0;
		this.getChildItems("root").forEach(boardItem => {
			if (!boardItem.exclude && boardItem.status & FoxAgeUtils.STATUS_ERROR)
				boardError++;
			threadError += (boardItem.error || 0);
		});
		var rootItem = this.getItem("root");
		if (boardError == (rootItem.boardError || 0) && threadError == (rootItem.threadError || 0))
			// dat落ちスレッドを含まない板を削除した場合、合計dat落ちスレッド数に変化なし
			return;
		this.changeItemProperty(rootItem, "boardError", boardError == 0 ? undefined : boardError);
		this.changeItemProperty(rootItem, "threadError", threadError == 0 ? undefined : threadError);
	},

	_manipulateDataWithSubjectTxt: function(aBoardItem, aSubjectTxt) {
		// キー: dat番号、値: スレッドアイテムでマップ化
		var dat2thread = new Map();
		this.getChildItems(aBoardItem.id).forEach(threadItem => {
			dat2thread.set(FoxAgeUtils.threadKeyOfItem(threadItem), threadItem);
		});
		var unread = 0;
		// subject.txtの各行を処理
		// 注意: 更新があったスレを先頭に移動させるため、最終行から順番に処理する
		aSubjectTxt.split("\n").reverse().forEach(line => {
			// ２ちゃんねる     : %dat番号%.dat<>%スレタイトル% (%レス数%)
			// まちBBS・したらば: %dat番号%.cgi,%スレタイトル%(%レス数%)
			if (!/^(\d+)\.(?:dat<>|cgi,).+\((\d{1,4})\)$/.test(line))
				return;
			var dat = RegExp.$1;
			if (!dat2thread.has(dat))
				return;
			var threadItem = dat2thread.get(dat);
			var lastRes = threadItem.lastRes || 0;
			var newRes = parseInt(RegExp.$2, 10);
			this.changeItemProperty(threadItem, "lastRes", newRes);
			// incorrect dat-out detectionからの復帰
			this._removeStatusFlag(threadItem, FoxAgeUtils.STATUS_DATOUT);
			if (newRes > lastRes) {
				this._addStatusFlag(threadItem, FoxAgeUtils.STATUS_UPDATED);
				// スレのアイテムを先頭（ルートの直後）へ移動
				var threadIndex = this._allItems.indexOf(threadItem);
				var removedItems = this._allItems.splice(threadIndex, 1);
				this._allItems.splice(1, 0, removedItems[0]);
				unread++;
			}
			// #debug-begin
			if (threadItem.status & FoxAgeUtils.STATUS_DATOUT)
				console.error("incorrect dat-out detection: " + threadItem.title);
			// LOG((newRes > lastRes ? "* " : "  ") + threadItem.id + " " + lastRes + "/" + newRes);
			// #debug-end
			dat2thread.delete(dat);
		});
		this._updateIndexForItemId();
		// subject.txtに存在しない＝dat落ちスレの処理
		for (var [dat, threadItem] of dat2thread) {
			// LOG("x " + threadItem.id);	// #debug
			this._removeStatusFlag(threadItem, FoxAgeUtils.STATUS_UPDATED);
			this._addStatusFlag(threadItem, FoxAgeUtils.STATUS_DATOUT);
			dat2thread.delete(dat);
		}
		// メッセージ表示
		var msg = unread > 0 ? browser.i18n.getMessage("updated", unread)
		                     : browser.i18n.getMessage("no_updated");
		this._notify("show-message", msg + ": " + aBoardItem.title);
 		// 板のプロパティを更新
		this._updateBoardStats(aBoardItem);
		this.changeItemProperty(aBoardItem, "checkDate", Math.floor(new Date().getTime() / 1000));
		this._notify("rebuild-tree");
	},

	////////////////////////////////////////////////////////////////////////////////
	// 更新チェック

	// 更新チェック処理待ちの板アイテムIDの配列
	_checkUpdatesQueue: [],

	// 更新チェック処理中のHTTPRequestインスタンスの配列
	_checkUpdatesRequests: [],

	// 現在進行中のfetchをすべて中断してキューもクリアする
	abortCheckUpdates: function() {
		this._checkUpdatesQueue = [];
		this._checkUpdatesRequests.forEach(request => request.destroy());
		this._checkUpdatesRequests = [];
		this._notify("check-stop");
	},

	// 更新チェック
	checkUpdates: function(aItemId) {
		// キューへの二重登録を制限
		if (this._checkUpdatesQueue.indexOf(aItemId) >= 0)
			return;
		// 現在チェック中の最大４つの板との重複を制限
		if (this._checkUpdatesRequests.some(request => request.itemId == aItemId))
			return;
		if (aItemId == "root") {
			// すべての板
			this._checkUpdatesQueue = this.getChildItems("root")
				.filter(item => item.type == FoxAgeUtils.TYPE_BOARD && !item.skip)
				.map(item => item.id);
			// UIへ開始メッセージ通知
			this._notify("check-start");
		}
		else if (this.getItem(aItemId).type == FoxAgeUtils.TYPE_SEPARATOR) {
			// 次の区切りまで
			let items = this.getChildItems("root");
			// 始点位置：引数で指定されたID
			// 終点位置：始点位置以降かつ最初の区切り
			let start = items.findIndex((item, i) => item.id == aItemId);
			let stop  = items.findIndex((item, i) => i > start && item.type == FoxAgeUtils.TYPE_SEPARATOR);
			if (start < 0)
				return;
			if (stop < 0)
				stop = items.length;
			this._checkUpdatesQueue = items.slice(start + 1, stop)
			    .filter(item => item.type == FoxAgeUtils.TYPE_BOARD && !item.skip)
				.map(item => item.id);
			// UIへ開始メッセージ通知
			this._notify("check-start");
		}
		else {
			// １個の板
			this._checkUpdatesQueue.push(aItemId);
		}
		// 最大同時接続数での接続開始
		var maxReq = Math.min(this._checkUpdatesQueue.length, this.getPref("maxRequests"));
		for (let i = 1; i <= maxReq; i++) {
			this._checkUpdatesNext();
		}
	},

	// 次の更新チェック処理へ
	_checkUpdatesNext: function() {
		// 完了したリクエストを配列から削除する
		for (var i = 0; i < this._checkUpdatesRequests.length; i++) {
			var request = this._checkUpdatesRequests[i];
			LOG(" [" + i + "] " + (request.active ? "o" : "x") + " " + request.itemId);	// #debug
			if (!request.active)
				this._checkUpdatesRequests.splice(i, 1);
		}
		// リクエストがいっぱいの場合、何もせず待つ
		var maxReq = Math.max(Math.min(this.getPref("maxRequests"), 4), 1);
		if (this._checkUpdatesRequests.length >= maxReq)
			return;
		// キューに何も無い場合、UIへ終了メッセージ通知
		var itemId = this._checkUpdatesQueue.shift();
		if (!itemId) {
			this._notify("check-stop");
			// 板のエラー数を更新する
			this._updateRootStats();
			return;
		}
		// アイテムが存在しないか板ではない場合、すぐに次のキューへ
		var boardItem = this.getItem(itemId);
		if (!boardItem || boardItem.type != FoxAgeUtils.TYPE_BOARD) {
			this._checkUpdatesNext();
			return;
		}
		// チェック中ステータスの追加
		this._addStatusFlag(boardItem, FoxAgeUtils.STATUS_CHECKING);
		this._notify("rebuild-tree", boardItem.id);
		this._notify("show-message", browser.i18n.getMessage("checking") + ": " + boardItem.title + "...");
		// 前回チェック日時との比較
		var newDate = Math.floor(new Date() / 1000);
		var diffTime = newDate - boardItem.checkDate;
		if (diffTime < LOCK_TIME) {
			setTimeout(() => {
				// チェック開始～抑止時間表示まで、あえて少しの時間をはさむ
				this._removeStatusFlag(boardItem, FoxAgeUtils.STATUS_CHECKING);
				this._notify("rebuild-tree", boardItem.id);
				this._notify("show-message", browser.i18n.getMessage("busy_wait", LOCK_TIME - diffTime));
				// 次のキューへ
				this._checkUpdatesNext();
			}, CHECK_INTERVAL);
			return;
		}
		else {
			// 最終チェック日時更新
			this.changeItemProperty(boardItem, "checkDate", newDate);
		}
		var url = FoxAgeUtils.parseToURL(boardItem, this.getPref("https")) + "subject.txt";
		var loadCallback = aResponseText => {
			let item = this.getItem(boardItem.id);
			if (item) {
				this._removeStatusFlag(item, FoxAgeUtils.STATUS_ERROR);
				this._removeStatusFlag(item, FoxAgeUtils.STATUS_CHECKING);
			}
			else LOG("item is already deleted: " + item.id);	// #debug
			this._manipulateDataWithSubjectTxt(item, aResponseText);
			// 次のキューへ
			setTimeout(() => this._checkUpdatesNext(), CHECK_INTERVAL);
		};
		var errorCallback = aHttpStatus => {
			var item = this.getItem(boardItem.id);
			if (item) {
				this._removeStatusFlag(item, FoxAgeUtils.STATUS_CHECKING);
				// ソケットエラーの場合はエラーのフラグを立てない
				if (aHttpStatus > 0)
					this._addStatusFlag(item, FoxAgeUtils.STATUS_ERROR);
				this._notify("show-message", browser.i18n.getMessage("error") + ` (${aHttpStatus})`);
				this._notify("rebuild-tree", item.id);
			}
			else LOG("item is already deleted: " + item.id);	// #debug
			// 次のキューへ
			setTimeout(() => this._checkUpdatesNext(), CHECK_INTERVAL);
		};
		var request = FoxAgeUtils.createHTTPRequest();
		request.itemId = boardItem.id;
		request.send(url, loadCallback, errorCallback);
		this._checkUpdatesRequests.push(request);
	},

	////////////////////////////////////////////////////////////////////////////////
	// 更新されたスレを開く

	_openUpdatesQueue: [],
	_openUpdatesTimer: null,

	cancelOpenUpdates: function() {
		if (this._openUpdatesTimer)
			clearTimeout(this._openUpdatesTimer);
		this._openUpdatesTimer = null;
		this._openUpdatesQueue = [];
		this._notify("open-stop");
	},

	openUpdates: async function(aItemId) {
		// キューへの二重登録を制限
		if (this._openUpdatesQueue.indexOf(aItemId) >= 0)
			return;
		// 全板・各板よらず、UIへ開始メッセージ通知
		await this._notify("open-start");
		if (aItemId == "root") {
			this._openUpdatesQueue = this.getChildItems("root")
			    .filter(item => item.type == FoxAgeUtils.TYPE_BOARD)
			    .map(item => item.id);
		}
		else if (this.getItem(aItemId).type == FoxAgeUtils.TYPE_SEPARATOR) {
			// 次の区切りまで
			let items = this.getChildItems("root");
			// 始点位置：引数で指定されたID
			// 終点位置：始点位置以降かつ最初の区切り
			let start = items.findIndex((item, i) => item.id == aItemId);
			let stop  = items.findIndex((item, i) => i > start && item.type == FoxAgeUtils.TYPE_SEPARATOR);
			if (start < 0)
				return;
			if (stop < 0)
				stop = items.length;
			this._openUpdatesQueue = items.slice(start + 1, stop)
			    .filter(item => item.type == FoxAgeUtils.TYPE_BOARD)
				.map(item => item.id);
		}
		else {
			this._openUpdatesQueue.push(aItemId);
		}
		this._openUpdatesNext();
	},

	_openUpdatesNext: function() {
		var itemId = this._openUpdatesQueue.shift();
		// キューに何も無い場合、UIへ終了メッセージ通知
		if (!itemId) {
			this._notify("open-stop");
			return;
		}
		var item = this.getItem(itemId);
		if (!item) {
			this._openUpdatesNext();
			return;
		}
		if (item.type == FoxAgeUtils.TYPE_BOARD) {
			// 板の中の未読スレを展開して配列の先頭に追加
			console.log("* " + item.title);	// #debug
			var threadItems = this.getChildItems(itemId).filter(aItem => {
				return aItem.status & FoxAgeUtils.STATUS_UPDATED;
			}).map(aItem => aItem.id);
			this._openUpdatesQueue = threadItems.concat(this._openUpdatesQueue);
			this._openUpdatesNext();
		}
		else if (item.type == FoxAgeUtils.TYPE_THREAD) {
			 this.openItem(item, true, false);
			//console.log(item.title);	// #debug
			if (this._openUpdatesQueue.length == 0)
				this._openUpdatesNext();
			else
				this._openUpdatesTimer = setTimeout(() => this._openUpdatesNext(), 3000);
		}
	},

	////////////////////////////////////////////////////////////////////////////////
	// タイトル取得

	// タイトル取得用のHTTPRequestオブジェクト
	_fetchTitleQueue: [],

	_fetchTitleRequest: null,

	// タイトル取得処理待ちのアイテムIDの配列
	abortFetchTitle: function() {
		this._fetchTitleQueue = [];
		if (this._fetchTitleRequest) {
			this._fetchTitleRequest.destroy();
			this._fetchTitleRequest = null;
		}
	},

	// タイトル取得
	fetchTitle: function(aItem) {
		// キューへの二重登録を制限
		if (this._fetchTitleQueue.indexOf(aItem.id) >= 0)
			return;
		this._fetchTitleQueue.push(aItem.id);
		if (this._fetchTitleQueue.length == 1)
			this._fetchTitleNext();
	},

	_fetchTitleNext: function() {
		var itemId = this._fetchTitleQueue.shift();
		if (!itemId) {
			this.abortFetchTitle();
			return;
		}
		var aItem = this.getItem(itemId);
		if (!aItem) {
			this._fetchTitleNext();
			return;
		}
		var url = FoxAgeUtils.parseToURL(aItem, this.getPref("https"));
		// スレの場合はレス1のみ取得すれば十分
		if (aItem.type == FoxAgeUtils.TYPE_THREAD)
			url += "1";
		this._notify("show-message", browser.i18n.getMessage("get_title") + "...");
		var loadCallback = aResponseText => {
			var item = this.getItem(itemId);
			if (item) {
				// ニコニコ動画掲示板のみ<h1>タグからタイトル取得
				var pattern = item.id.startsWith("bbs.nicovideo.jp")
				            ? /<h1>([^<]+)<\/h1>/i : /<title>([^<]+)<\/title>/i;
				if (pattern.test(aResponseText)) {
					var title = RegExp.$1;
					title = FoxAgeUtils.unescapeEntities(title);
					title = FoxAgeUtils.sanitizeTitle(title);
					if (item.type == FoxAgeUtils.TYPE_BOARD)
						// 「＠2ch掲示板」「＠bbspink掲示板」などをカット
						title = title.replace(/\uFF20.+$/, "");
					this.changeItemProperty(item, "title", title);
					this._notify("rebuild-tree", item.id);
					this._notify("show-message", browser.i18n.getMessage("done"));
				}
				else console.error("title is not found:\n" + aResponseText);
			}
			else console.error("item is already deleted: " + item.id);	// #debug
			// 次のタイトル取得
			setTimeout(() => this._fetchTitleNext(), CHECK_INTERVAL);
		};
		var errorCallback = aHttpStatus => {
			var item = this.getItem(itemId);
			if (item.type == FoxAgeUtils.TYPE_THREAD) {
				// スレッドのタイトル取得失敗時、subject.txtからタイトル取得
				setTimeout(() => this._fetchTitleFromSubjectTxt(item), CHECK_INTERVAL);
			}
			else {
				this._notify("show-message", browser.i18n.getMessage("error") + " (" + aHttpStatus + ")");
				// 次のタイトル取得
				setTimeout(() => this._fetchTitleNext(), CHECK_INTERVAL);
			}
		};
		this._fetchTitleRequest = FoxAgeUtils.createHTTPRequest();
		this._fetchTitleRequest.itemId = itemId;
		this._fetchTitleRequest.send(url, loadCallback, errorCallback);
	},

	// subject.txtからタイトルを取得する
	// fetchTitleでスレッドのタイトル取得失敗時に呼び出される
	// _fetchTitleQueueのキューに関係なく、最優先で処理を実行する。
	_fetchTitleFromSubjectTxt: function(aItem) {
		var url = FoxAgeUtils.parseToURL(this.getItem(aItem.parent), this.getPref("https"))
		        + "subject.txt";
		this._notify("show-message", browser.i18n.getMessage("get_title") + " (subject.txt)...");
		var loadCallback = aResponseText => {
			var item = this.getItem(aItem.id);
			if (item) {
				// @see findThread.js FindThread.init
				// 1213352492.dat<>Mozilla Firefox Part85 (39) → %key%.dat<>%title% (nn)
				// 1212650212.cgi,ぷよぷよシリーズ！(72)       → %key%.cgi,%title%(nn)
				var dat = FoxAgeUtils.threadKeyOfItem(item);
				var pattern = new RegExp(dat + "\\.(?:dat<>|cgi,)(.+)\\s*\\(\\d+\\)");
				if (pattern.test(aResponseText)) {
					var title = RegExp.$1;
					title = FoxAgeUtils.unescapeEntities(title);
					title = FoxAgeUtils.sanitizeTitle(title);
					this.changeItemProperty(item, "title", title);
					this._notify("rebuild-tree", item.id);
					this._notify("show-message", browser.i18n.getMessage("done"));
				}
				else console.error("title is not found in subject.txt:\n" + aResponseText);
			}
			else console.error("item is already deleted: " + item.id);	// #debug
			// 次のタイトル取得
			setTimeout(() => this._fetchTitleNext(), CHECK_INTERVAL);
		};
		var errorCallback = aHttpStatus => {
			this._notify("show-message", browser.i18n.getMessage("error") + " (" + aHttpStatus + ")");
			// 次のタイトル取得
			setTimeout(() => this._fetchTitleNext(), CHECK_INTERVAL);
		};
		this._fetchTitleRequest = FoxAgeUtils.createHTTPRequest();
		this._fetchTitleRequest.itemId = aItem.id;
		this._fetchTitleRequest.send(url, loadCallback, errorCallback);
	},

	// 指定したURLに対応する板またはスレッドを登録する
	// ツリー再描画後にPromiseを返す
	subscribe: async function(aURL) {
		try {
			var [boardId, threadId] = FoxAgeUtils.parseFromURL(aURL);
			if (boardId && threadId) {
				// スレッドを追加
				var boardItem = this.getItem(boardId);
				if (!boardItem) {
					// 板も追加
					boardItem = FoxAgeUtils.createBoardItem(boardId);
					await this.insertItem(boardItem, null);
					this.fetchTitle(boardItem);
				}
				var threadItem = FoxAgeUtils.createThreadItem(threadId, boardItem);
				await this.insertItem(threadItem, null);
				this.fetchTitle(threadItem);
				return [boardItem, threadItem];
			}
			else if (boardId) {
				// 板を追加
				var boardItem = FoxAgeUtils.createBoardItem(boardId);
				await this.insertItem(boardItem, null);
				this.fetchTitle(boardItem);
				return [boardItem];
			}
		}
		catch (ex) {
			var msg = "";
/*
			switch (ex.message) {
				case "invalid URL"   : msg = "invalid_URL"; break;
				case "already exists": msg = "already_added"; break;
				default              : msg = "error"; break;
			}
			this._notify("show-message", browser.i18n.getMessage(msg));
*/
			if (ex.message == "invalid URL")
				msg = browser.i18n.getMessage("invalid_URL") + ": " + aURL;
			else if (ex.message == "already exists")
				msg = browser.i18n.getMessage("already_added");
			else
				msg = browser.i18n.getMessage("error");
			this._notify("show-message", msg);
		}
	},

	// ツールバーボタンクリック時
	_handleBrowserAction: async function(tab) {
/*
		// 非同期になるとイベントハンドラとは別の制約を受けるため動作しない
		let open = await browser.sidebarAction.isOpen({});
		open ? browser.sidebarAction.close()
		     : browser.sidebarAction.open();
*/
		// 面倒なのでひとまずはサイドバーを開くだけにする
		browser.sidebarAction.open();
	},

	// メッセージ送信→応答→Promiseを返す
	_notify: function(aTopic, aValue) {
		return browser.runtime.sendMessage({ topic: aTopic, value: aValue });
	},

};

FoxAgeSvc._init();

