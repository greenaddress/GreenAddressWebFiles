var angular = require('angular');
var greenWalletServices = angular.module('greenWalletServices', []);
module.exports = greenWalletServices;

require('./services/index')(greenWalletServices);

greenWalletServices
  .factory('reddit', ['$q', function($q) {
    var redditService = {
        getToken: function(scope) {
            var tokenDeferred = $q.defer();
            var state = Math.random();
            var left = screen.width / 2 - 500, top = screen.height / 2 - 300;
            if (window.location.hostname == 'localhost') {
                var redir = 'http://localhost:9908/reddit/';
            } else {
                var redir = 'https://'+window.location.hostname+'/reddit/';
            }
            var w = window.open('https://ssl.reddit.com/api/v1/authorize?client_id='+REDDIT_APP_ID+'&redirect_uri='+redir+'&response_type=code&scope='+scope+'&state=' + state,
                        '_blank', 'toolbar=0,menubar=0,width=1000,height=600,left='+left+',top='+top);
            var deferred = $q.defer();
            var interval = setInterval(function() { if (w.closed) {
                clearInterval(interval);
                deferred.resolve(true);
            } }, 500);
            deferred.promise.then(function() {
                if (window._reddit_token) {
                    tokenDeferred.resolve(_reddit_token);
                    _reddit_token = undefined;
                } else {
                    tokenDeferred.resolve(null);
                }
            });
            return tokenDeferred.promise;
        }
    };
    return redditService;
}]).factory('cordovaReady', function cordovaReady() {
  return function (fn) {
    // cordovaReady is called even when there is no Cordova support, hence
    // the plain `return fn` below.

    // This is because WebSockets are implemented on Android in Cordova,
    // so the initial implementation was a generic wrapper which runs
    // code even without Cordova, to allow running the same WebSockets
    // code on desktop and Android.

    // (See the usage in js/greenwallet/services.js: ab.connect()
    // is wrapped inside cordovaReady, because it uses WebSockets)

    // Maybe it might be better to add some runEvenWithoutCordova
    // argument to cordovaReady for that WebSockets special case,
    // and by default don't run anything on desktop from the function
    // returned there...
    if (!window.cordova) {
        return fn;
    }

    var queue = [];

    var impl = function () {
      queue.push([this, Array.prototype.slice.call(arguments)]);
    };

    document.addEventListener('deviceready', function () {
      queue.forEach(function (args) {
        fn.apply(args[0], args[1]);
      });
      impl = fn;
      navigator.splashscreen.hide();
    }, false);

    return function () {
      return impl.apply(this, arguments);
    };
  };
}).factory('hostname', function() {
    var is_chrome_app = window.chrome && chrome.storage;
    if (is_chrome_app || window.cordova) {
        return 'greenaddress.it';
    } else {
        return window.location.hostname.replace('cordova.', '').replace('cordova-t.', '')
    }
}).factory('gaEvent', function gaEvent() {
    return function(category, action, label) {
        if (window._gaq) {
            try {
                if (category == '_pageview') {
                    _gaq.push(['_trackPageview', action]);
                } else {
                    _gaq.push(['_trackEvent', category, action, label]);
                }
            } catch (e) {}
        }
    }
}).factory('parseKeyValue', function() {
    var tryDecodeURIComponent = function (value) {
        try {
            return decodeURIComponent(value);
        } catch(e) {
            // Ignore any invalid uri component
        }
    };
    return function parseKeyValue(keyValue) {
        var obj = {}, key_value, key;
        angular.forEach((keyValue || "").split('&'), function(keyValue){
            if ( keyValue ) {
                key_value = keyValue.split('=');
                key = tryDecodeURIComponent(key_value[0]);
                if ( key !== undefined ) {
                    var val = (key_value[1] !== undefined) ? tryDecodeURIComponent(key_value[1]) : true;
                    if (!obj[key]) {
                        obj[key] = val;
                    } else if(toString.call(obj[key]) === '[object Array]') {
                        obj[key].push(val);
                    } else {
                        obj[key] = [obj[key],val];
                    }
                }
            }
        });
        return obj;
    };
}).factory('parse_bitcoin_uri', ['parseKeyValue', function(parseKeyValue) {
    return function parse_bitcoin_uri(uri) {
        if (uri.indexOf === undefined || uri.indexOf("bitcoin:") == -1) {
            // not a URI
            return {};
        } else {
            if (uri.indexOf("?") == -1) {
                // no amount
                return {recipient: uri.split("bitcoin:")[1]};
            } else {
                var recipient =  uri.split("bitcoin:")[1].split("?")[0];
                var variables = parseKeyValue(uri.split('bitcoin:')[1].split('?')[1]);
                variables.recipient = recipient;
                return variables;
            }
        }
    }
}]).factory('storage', ['$q', function($q) {
    if (window.chrome && chrome.storage) {
        var noLocalStorage = false;
    } else {
        try {
            var noLocalStorage = !window.localStorage;
        } catch(e) {
            var noLocalStorage = true;
        }
    }
    var storageService = {
        noLocalStorage: noLocalStorage,
        set: function(key, value) {
            if (window.chrome && chrome.storage) {
                var set_value = {};
                set_value[key] = value;
                chrome.storage.local.set(set_value);
            } else {
                if(!noLocalStorage) {
                    localStorage.setItem(key, value);
                }
            }
        },
        get: function(key) {
            var d = $q.defer();
            if (window.chrome && chrome.storage) {
                chrome.storage.local.get(key, function(items) {
                    var key_arr;
                    if (key.constructor == Array) {
                        key_arr = key;
                    } else {
                        key_arr = [key];
                    }
                    // make it compatible with localStorage.getItem:
                    // (returns null if key is missing)
                    for (var i = 0; i < key_arr.length; ++i) {
                        if (items[key_arr[i]] === undefined) {
                            items[key_arr[i]] = null;
                        }
                    }
                    if (key.constructor === Array) {
                        d.resolve(items);
                    } else {
                        d.resolve(items[key]);
                    }
                });
            } else {
                if (key.constructor === Array) {
                    var ret = {};
                    if (!noLocalStorage) {
                        for (var i = 0; i < key.length; ++i) {
                            ret[key[i]] = localStorage.getItem(key[i]);
                        }
                    }
                    d.resolve(ret);
                } else {
                    if (!noLocalStorage) {
                        d.resolve(localStorage.getItem(key));
                    } else {
                        d.resolve();
                    }
                }
            }
            return d.promise;
        },
        remove: function(key) {
            if (window.chrome && chrome.storage) {
                chrome.storage.local.remove(key);
            } else {
                localStorage.removeItem(key);
            }
        }
    };
    return storageService;
}]).factory('device_id', ['storage', function(storage) {
    var uuid4 = function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var nums = new Uint32Array(1), r, v;
            window.crypto.getRandomValues(nums);
            r = nums[0] % 16,
            v = (c === 'x') ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }
    return function() {
        return storage.get('device_id').then(function(value) {
            if (!value) {
                var ret = uuid4();
                storage.set('device_id', ret)
                return ret;
            } else return value;
        })
    };
}]).factory('user_agent', [function() {
    var is_chrome_app = window.chrome && chrome.storage,
        is_cordova_app = window.cordova;
    return function(wallet) {
        if (is_cordova_app) {
            return 'Cordova ' + cordova.platformId +
                ' (version=' + wallet.version + ')';
        } else if (is_chrome_app) {
            return 'Chrome ' + '(version=' + wallet.version + ')';
        } else {
            return 'Browser';
        }
    };
}]).factory('addressbook', ['$rootScope', 'tx_sender', 'storage', 'crypto', 'notices', '$q',
        function($rootScope, tx_sender, storage, crypto, notices, $q) {
    var PER_PAGE = 15;
    return {
        items: [],
        reverse: {},
        new_item: undefined,
        populate_csv: function() {
            var csv_list = [];
            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
                csv_list.push(item.name + ',' + (item.href || item.address));
            }
            this.csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv_list.join('\n'));
        },
        init_partitions: function(items) {
            var items = items || this.items, next_prefix, next_partition;
            var items_copy = [];
            for (var i = 0; i < items.length; i++) items_copy.push(items[i]);
            this.partitions = [];
            var get_name = function (item) {
                // works with 'unprocessed' and 'processed' items
                if (item.name) return item.name;
                else return item[0];
            }
            while (items_copy.length) {
                var prefix = next_prefix || get_name(items_copy[0])[0];
                var partition = next_partition || [];
                for (var i = 0; i < PER_PAGE; i++) {
                    if (!items_copy.length) break;
                    var next_item = this._process_item(items_copy.shift());
                    if (next_item) partition.push(next_item);
                    else i -= 1;  // crx facebook
                }
                if (items_copy.length) {
                    var next_prefix = get_name(items_copy[0])[0], next_partition = [];
                    while (next_prefix == partition[partition.length-1].name.substring(0, next_prefix.length) &&
                           next_prefix.length < get_name(items_copy[0]).length) {
                        next_prefix += get_name(items_copy[0])[next_prefix.length];
                        if (next_prefix.length == 3) {
                            while (partition.length &&
                                    partition[partition.length-1].name.substring(0, 3) == next_prefix) {
                                next_partition.push(partition.pop());
                            }
                            break;
                        }
                    }
                }
                if (partition.length) {
                    this.partitions.push([this.partitions.length+1, prefix, partition]);
                }
            }
        },
        _process_item: function(value) {
            var is_chrome_app = window.chrome && chrome.storage;
            if (value.name) return value;
            if (value[3] == 'facebook') {
                var has_wallet = value[4];
                if (!has_wallet && (is_chrome_app || window.cordova)) return;  // can't send FB messages from Chrome/Cordova app
                var href = 'https://www.facebook.com/' + value[1];
                return {name: value[0], type: value[3], address: value[1], has_wallet: has_wallet, href: href};
            } else {
                return {name: value[0], type: value[3], has_wallet: value[4], address: value[1]};
            }
        },
        update_with_items: function(items, $routeParams) {
            while (this.items.length) this.items.pop();
            this.reverse = {};
            if (!$routeParams) $routeParams = {};
            var that = this;
            items.sort(function(a, b) { return a[0].localeCompare(b[0]); });
            this.init_partitions(items);
            var i = 0;
            angular.forEach(items, function(value) {
                var item = that._process_item(value);
                if (!item) return;  // crx facebook
                if (value[3] != 'facebook') {
                    that.reverse[value[1]] = value[0];
                }
                that.items.push(item);
                if (value[0] === $routeParams.name) $routeParams.page = Math.ceil((i+1)/PER_PAGE);
                i += 1;
            });
            that.num_pages = Math.ceil(that.items.length / 20);
            that.pages = [];
            for (var i = 1; i <= that.num_pages; i++) that.pages.push(i);
            that.populate_csv();
        },
        load: function($scope, $routeParams) {
            var addressbook_key = $scope.wallet.receiving_id + 'addressbook'
            var cache;
            var that = this;
            return storage.get(addressbook_key).then(function(cache) {
                try {
                    cache = JSON.parse(cache) || {};
                } catch(e) {
                    cache = {};
                }
                var d;
                var subaccounts = [];
                // start with i = 1 - do not show 'Main' in the addressbook
                for (var i = 1; i < $scope.wallet.subaccounts.length; i++) {
                    var account = $scope.wallet.subaccounts[i];
                    subaccounts.push([account.name, account.receiving_id, '', 'subaccount', true]);
                }
                if (cache.hashed) {
                    d = crypto.decrypt(cache.items, $scope.wallet.cache_password).then(function(decrypted) {
                        that.update_with_items(JSON.parse(decrypted).concat(subaccounts), $routeParams);
                    });
                    var requires_load = false;
                } else {
                    $rootScope.is_loading += 1;
                    d = $q.when();
                    requires_load = true;
                }

                return d.then(function() {
                    return tx_sender.call('http://greenaddressit.com/addressbook/read_all', cache.hashed).then(function(data) {
                        if (data.items) {
                            var items = data.items;
                            crypto.encrypt(JSON.stringify(data.items), $scope.wallet.cache_password).then(function(encrypted) {
                                cache.items = encrypted;
                                cache.hashed = data.hashed;
                                storage.set(addressbook_key, JSON.stringify(cache));
                            });
                            that.update_with_items(items.concat(subaccounts), $routeParams);
                        }
                    }, function(err) {
                        notices.makeNotice('error', gettext('Error reading address book: ') + err.args[1]);
                    }).finally(function() {
                        if (requires_load) {
                            $rootScope.decrementLoading();
                        }
                    });
                });
            });
        }
    };
}]).factory('clipboard', ['$q', 'cordovaReady', function($q, cordovaReady) {
    return {
        copy: function(data) {
            var deferred = $q.defer();
            cordovaReady(function(){
                cordova.plugins.clipboard.copy(data, function() {
                    deferred.resolve(gettext('Copied'));
                }, function() {
                    deferred.reject(gettext('Error copying'));
                });
            })();
            return deferred.promise;
    }};

}]).factory('sound', ['cordovaReady', '$timeout', function(cordovaReady, $timeout) {
    return {
        play: function(src, $scope) {
            cordovaReady(function(){
                if (!$scope || !$scope.wallet.appearance.sound) {
                    return;
                }
                if (window.cordova && typeof Media != "undefined") {
                    // Phonegap media
                    var mediaRes = new Media(src,
                        function onSuccess() {
                            // release the media resource once finished playing
                            mediaRes.release();
                        },
                        function onError(e){
                            console.log("error playing sound: " + JSON.stringify(e));
                        });
                    mediaRes.play();
                } else if (typeof Audio != "undefined") {
                    //HTML5 Audio
                    $timeout(function() { new Audio(src).play(); });
                } else {
                    console.log("no sound API to play: " + src);
                }
            })();
    }};

}]).factory('qrcode', ['$q', 'cordovaReady', '$timeout', function($q, cordovaReady, $timeout) {
    var n = navigator, v, webkit = false, moz = false, gCtx, stream, gotGUMerror = false;
    return {
    stop_scanning: function($scope) {
        $scope.scanning_qr_video = false;
        v.pause();
        try {
            stream.stop();
        } catch (e) {
            stream.getVideoTracks()[0].stop();
        }
    },
    scan: function($scope, $event, suffix) {
        var that = this;
        var deferred = $q.defer();
        if (window.cordova) {
            $event.preventDefault();
            cordovaReady(function()  {
                cordova.plugins.barcodeScanner.scan(
                    function (result) {
                        console.log("We got a barcode\n" +
                        "Result: " + result.text + "\n" +
                        "Format: " + result.format + "\n" +
                        "Cancelled: " + result.cancelled);
                        if (!result.cancelled && result.format == "QR_CODE") {
                              $timeout(function() { deferred.resolve(result.text); });
                        } else {
                            if (result.cancelled) {
                                $timeout(function() { deferred.reject(gettext('Cancelled')); });
                            } else {
                                $timeout(function() { deferred.reject(gettext('Invalid format')); });
                            }
                        }
                    },
                    deferred.reject
                );
            })();
        } else {
            v = document.getElementById("v" + (suffix||''));
            qrcode.callback = function(result) {
                if(result === 'error decoding QR Code') {
                    deferred.reject(gettext('Could not process the QR code, the image may be blurry. Please try again.'));
                    return;
                }
                deferred.resolve(result);
            };
            function captureToCanvas() {
                try{
                    gCtx.drawImage(v,0,0);
                    try{
                        qrcode.decode();
                        that.stop_scanning($scope);
                    }
                    catch(e){
                        console.log(e);
                        setTimeout(captureToCanvas, 500);
                    };
                }
                catch(e){
                        console.log(e);
                        setTimeout(captureToCanvas, 500);
                };
            }
            var success = function(stream_) {
                $scope.$apply(function() {
                    $scope.scanning_qr_video = true;
                });
                stream = stream_;
                gCanvas = document.getElementById("qr-canvas");
                var w = 800, h = 600;
                gCanvas.style.width = w + "px";
                gCanvas.style.height = h + "px";
                gCanvas.width = w;
                gCanvas.height = h;
                gCtx = gCanvas.getContext("2d");
                gCtx.clearRect(0, 0, w, h);
                if(webkit)
                    v.src = window.webkitURL.createObjectURL(stream);
                else if(moz){
                    v.mozSrcObject = stream;
                    v.play();
                } else {
                    v.src = stream;
                }
                setTimeout(captureToCanvas, 500);
            }
            var error = function() {
                $scope.gotGUMerror = true; // for some reason dispatchEvent doesn't work inside error()
                deferred.reject(gettext('Access denied. Retry to scan from file.'));
            };
            var scan_input = function() {
                var qr = $event.target;
                angular.element(qr).on('change', function(event) {
                    if (event.target.files.length != 1 && event.target.files[0].type.indexOf("image/") != 0) {
                        notices.makeNotice('error', gettext('You must provide only one image file.'));
                        return;
                    }

                    // https://github.com/kyledrake/coinpunk/blob/master/public/js/coinpunk/controllers/tx.js#L195
                    /*! Copyright (c) 2013, Kyle Drake */

                    var canvas = document.getElementById("qr-canvas");
                    if (!canvas) {
                        canvas = document.createElement('canvas');
                    }
                    var context = canvas.getContext('2d');
                    var img = new Image();
                    img.onload = function() {
                        /*
                        Helpful URLs:
                        http://hacks.mozilla.org/2011/01/how-to-develop-a-html5-image-uploader/
                        http://stackoverflow.com/questions/19432269/ios-html5-canvas-drawimage-vertical-scaling-bug-even-for-small-images

                        There are a lot of arbitrary things here. Help to clean this up welcome.

                        context.save();
                        context.scale(1e6, 1e6);
                        context.drawImage(img, 0, 0, 1e-7, 1e-7, 0, 0, 1e-7, 1e-7);
                        context.restore();
                        */

                        if((img.width == 2448 && img.height == 3264) || (img.width == 3264 && img.height == 2448)) {
                            canvas.width = 1024;
                            canvas.height = 1365;
                            context.drawImage(img, 0, 0, 1024, 1365);
                        } else if(img.width > 1024 || img.height > 1024) {
                            canvas.width = img.width*0.15;
                            canvas.height = img.height*0.15;
                            context.drawImage(img, 0, 0, img.width*0.15, img.height*0.15);
                        } else {
                            canvas.width = img.width;
                            canvas.height = img.height;
                            context.drawImage(img, 0, 0, img.width, img.height);
                        }
                        qrcode.decode(canvas.toDataURL('image/png'));
                    }

                    img.src = URL.createObjectURL(event.target.files[0]);
                });
            };
            var tryGUM = function(source) {
                if (n.getUserMedia && !$scope.gotGUMerror) {
                    n.getUserMedia({video: source, audio: false}, success, error);
                    $event.preventDefault();
                } else if (n.webkitGetUserMedia && !$scope.gotGUMerror) {
                    webkit = true;
                    n.webkitGetUserMedia({video: source, audio: false}, success, error);
                    $event.preventDefault();
                } else if (n.mozGetUserMedia && !$scope.gotGUMerror) {
                    moz = true;
                    n.mozGetUserMedia({video: source, audio: false}, success, error);
                    $event.preventDefault();
                } else {
                    scan_input();
                }
            };
            if (window.MediaStreamTrack && MediaStreamTrack.getSources && !$scope.gotGUMerror) {
                $event.preventDefault();
                MediaStreamTrack.getSources(function(sources) {
                    var found = false;
                    for (var i = 0; i < sources.length; i++) {
                        if (sources[i].kind == 'video' && sources[i].facing == 'environment') {
                            found = true;
                            tryGUM({optional: [{sourceId: sources[i].id}]});
                            break;
                        }
                    }
                    if (!found) tryGUM(true);
                });
            } else {
                tryGUM(true);
            }
        }
        return deferred.promise;
    }};
}]).factory('hw_detector', ['$q', 'trezor', 'btchip', '$timeout', '$rootScope', '$uibModal',
        function($q, trezor, btchip, $timeout, $rootScope, $uibModal) {
    return {
        success: false,
        showModal: function(d) {
            var that = this;
            if (!that.modal) {
                $rootScope.safeApply(function() {
                    var options = {
                        templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_usb_device.html',
                    };
                    that.modal = $uibModal.open(options);
                    that.modal.result.finally(function() {
                        if (!that.success) d.reject();
                    });
                });
            };
        },
        waitForHwWallet: function() {
            var d = $q.defer(), that = this;
            var doSuccess = function() {
                d.resolve();
                that.success = true;
                if (that.modal) {
                    that.modal.close();  // modal close cancels the tick
                }
            }
            var check = function() {
                trezor.getDevice(true).then(function() {
                    doSuccess();
                }, function(err) {
                    if (err && (err.pluginLoadFailed || err.outdatedFirmware)) {
                        // don't retry on unrecoverable errors
                        d.reject();
                        return;
                    }
                    btchip.getDevice(true).then(function() {
                        doSuccess();
                    }, function() {
                        // can be set to success by signup (if trezor got connected)
                        if (!that.success) that.showModal(d);
                        $timeout(check, 1000);
                    });
                })
            }
            check();
            return d.promise;
        }
    }
}]).factory('trezor', ['$q', '$interval', '$uibModal', 'notices', '$rootScope', 'focus',
        function($q, $interval, $uibModal, notices, $rootScope, focus) {

    var trezor_api, transport, trezor;

    var promptPin = function(type, callback) {
        var scope, modal;
        scope = angular.extend($rootScope.$new(), {
            pin: '',
            type: type
        });

        modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_trezor_pin.html',
            size: 'sm',
            windowClass: 'pinmodal',
            backdrop: 'static',
            keyboard: false,
            scope: scope
        });

        modal.result.then(
            function (res) { callback(null, res); },
            function (err) { callback(err); }
        );
    };

    var promptPassphrase = function(callback) {
        var scope, modal;

        scope = angular.extend($rootScope.$new(), {
            passphrase: '',
        });

        modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_trezor_passphrase.html',
            size: 'sm',
            windowClass: 'pinmodal',
            backdrop: 'static',
            keyboard: false,
            scope: scope
        });

        modal.result.then(
            function (res) { callback(null, res); },
            function (err) { callback(err); }
        );
    };

    var handleError = function(e) {
        var message;
        if (e == 'Opening device failed') {
            message = gettext("Device could not be opened. Make sure you don't have any TREZOR client running in another tab or browser window!");
        } else {
            message = e;
        }
        $rootScope.safeApply(function() {
            notices.makeNotice('error', message);
        });
    };

    var handleButton = function(dev) {
        var modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_trezor_confirm_button.html',
            size: 'sm',
            windowClass: 'pinmodal',
            backdrop: 'static',
            keyboard: false
        });

        dev.once('pin', function () {
            try { modal.close(); } catch (e) {}
        });
        dev.once('receive', function () {
            try { modal.close(); } catch (e) {}
        });
        dev.once('error', function () {
            try { modal.close(); } catch (e) {}
        });
    }

    return {
        getDevice: function(noModal, silentFailure) {
            var deferred = $q.defer();
            var is_chrome_app = window.chrome && chrome.storage;
            if (!is_chrome_app) return deferred.promise;

            var tick, modal;
            var showModal = function() {
                if (!noModal && !modal) {
                    modal = $uibModal.open({
                        templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_usb_device.html',
                    });
                    modal.result.finally(function() {
                        if (tick) {
                            $interval.cancel(tick);
                        }
                    });
                }
            }

            if (trezor_api) {
                var plugin_d = $q.when(trezor_api);
            } else {
                var plugin_d = window.trezor.load();
            }
            plugin_d.then(function(api) {
                trezor_api = api;
                tick = $interval(function() {
                    var enumerate_fun = is_chrome_app ? 'devices' : 'enumerate';
                    $q.when(trezor_api[enumerate_fun]()).then(function(devices) {
                        if (devices.length) {
                            if (noModal) {
                                $interval.cancel(tick);
                            } else if (modal) {
                                modal.close();  // modal close cancels the tick
                            } else {
                                $interval.cancel(tick);
                            }
                            var acquire_fun = is_chrome_app ? 'open' : 'acquire';
                            $q.when(trezor_api[acquire_fun](devices[0])).then(function(dev_) {
                                if (!is_chrome_app) dev_ = new trezor.Session(transport, dev_.session);
                                deferred.resolve(dev_.initialize().then(function(init_res) {
                                    var outdated = false;
                                    if (init_res.message.major_version < 1) outdated = true;
                                    else if (init_res.message.major_version == 1 &&
                                             init_res.message.minor_version < 3) outdated = true;
                                    if (outdated) {
                                        notices.makeNotice('error', gettext("Outdated firmware. Please upgrade to at least 1.3.0 at http://mytrezor.com/"));
                                        return $q.reject({outdatedFirmware: true});
                                    } else {
                                        return dev_;
                                    }
                                }).then(function(dev) {
                                    trezor_dev = dev;
                                    trezor_dev.on('pin', promptPin);
                                    trezor_dev.on('passphrase', promptPassphrase);
                                    trezor_dev.on('error', handleError);
                                    trezor_dev.on('button', function () {
                                        handleButton(dev);
                                    });
                                    return trezor_dev;
                                }));
                            }, function(err) {
                                handleError('Opening device failed');
                            });
                        } else if (noModal) {
                            if (noModal == 'retry') return;
                            deferred.reject();
                        } else showModal();
                    }, function() {
                        if (noModal) {
                            if (noModal == 'retry') return;
                            $interval.cancel(tick);
                            deferred.reject();
                        } else showModal();
                    })
                }, 1000);
            }).catch(function(e) {
                if (!silentFailure) {
                    $rootScope.safeApply(function() {
                        // notices.makeNotice('error', gettext('TREZOR initialisation failed') + ': ' + e);
                    });
                }
                deferred.reject({pluginLoadFailed: true})
            });
            return deferred.promise;
        },
        recovery: function(mnemonic) {
            return this.getDevice().then(function(dev) {
                return dev.wipeDevice().then(function(res) {
                    return dev.loadDevice({mnemonic: mnemonic});
                });
            });
        },
        setupSeed: function(mnemonic) {
            var scope = $rootScope.$new(), d = $q.defer(), trezor_dev, modal, service = this;
            scope.trezor = {
                use_gait_mnemonic: !!mnemonic,
                store: function() {
                    this.setting_up = true;
                    var store_d;
                    if (mnemonic) {
                        store_d = service.recovery(mnemonic);
                    } else {
                        store_d = trezor_dev.resetDevice({strength: 256});
                    }
                    store_d.then(function() {
                        modal.close();
                        d.resolve();
                    }).catch(function(err) {
                        this.setting_up = false;
                        if (err.message) return;  // handled by handleError in services.js
                        notices.makeNotice('error', err);
                    });
                },
                reuse: function() {
                    modal.close();
                    d.resolve();
                }
            };
            var do_modal = function() {
                modal = $uibModal.open({
                    templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_trezor_setup.html',
                    scope: scope
                });
                modal.result.catch(function() { d.reject(); });
            }
            this.getDevice().then(function(trezor_dev_) {
                trezor_dev = trezor_dev_;
                trezor_dev.getPublicKey([]).then(function(pk) {
                    scope.trezor.already_setup = true;
                    do_modal();
                }, function(err) {
                    if (err.code != 11) {  // Failure_NotInitialized
                        notices.makeNotice("error", err.message)
                    }
                    do_modal();
                })
            });
            return d.promise;
        }
    };
}]).factory('btchip', ['$q', '$interval', '$uibModal', '$rootScope', 'mnemonics', 'notices', 'focus', 'cordovaReady', '$injector',
        function($q, $interval, $uibModal, $rootScope, mnemonics, notices, focus, cordovaReady, $injector) {

    /**@TODO
        This should be broken into 2 services
        1 service should monitor and event based on the state of hardware wallets
        and expose an API for interacting with them
        a second service should manage UI events based on the behavior of these
        wallets. This isolation will make HW wallets easier to support and the 
        UI's related to them easier to maintain... it will also allow us to 
        cleave off any reusable code for HW wallets we want to publish into the
        ecosystem

        This will require a refactor since currently the business logic and UI 
        control flow are bound directly to each other
    */
    var cardFactory;
    if (window.ChromeapiPlugupCardTerminalFactory) {
        cardFactory = new ChromeapiPlugupCardTerminalFactory();
        cardFactoryBootloader = new ChromeapiPlugupCardTerminalFactory(0x1808);
    }

    var BTChipCordovaWrapper = function() {
        var dongle = {
            disconnect_async: function() {
                var d = $q.defer();
                cordova.exec(function() {
                    d.resolve();
                }, function(fail) {
                    d.reject(fail);
                }, "BTChip", "disconnect", []);
                return d.promise;
            }
        }
        return {
            app: {
                getFirmwareVersion_async: function() {
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        result = new ByteString(result, HEX);
                        d.resolve({
                            compressedPublicKeys: result.byteAt(0) == 0x01,
                            firmwareVersion: result.bytes(1)
                        });
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "getFirmwareVersion", []);
                    return d.promise;
                },
                verifyPin_async: function(pin) {
                    if (this.pin_verified) return $q.when();
                    var that = this;
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        that.pin_verified = true;
                        d.resolve();
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "verifyPin", [pin.toString(HEX)]);
                    return d.promise;
                },
                getWalletPublicKey_async: function(path) {
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        d.resolve({
                            bitcoinAddress: {value: result.bitcoinAddress},
                            chainCode: new ByteString(result.chainCode, HEX),
                            publicKey: new ByteString(result.publicKey, HEX),
                        });
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "getWalletPublicKey", [path]);
                    return d.promise;
                },
                signMessagePrepare_async: function(path, msg) {
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        d.resolve(result);
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "signMessagePrepare", [path, msg.toString(HEX)]);
                    return d.promise;
                },
                signMessageSign_async: function(pin) {
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        d.resolve(new ByteString(result, HEX));
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "signMessageSign", [pin.toString(HEX)]);
                    return d.promise;
                },
                gaStartUntrustedHashTransactionInput_async: function(newTransaction, tx, i) {
                    var d = Q.defer();
                    var inputs = [];
                    for (var j = 0; j < tx.ins.length; j++) {
                        var input = tx.ins[j];
                        var txhash = input.hash.toString('hex');
                        var outpointAndSequence = new Bitcoin.Buffer.Buffer(8);
                        outpointAndSequence.writeUInt32LE(input.index, 0);
                        outpointAndSequence.writeUInt32LE(input.sequence, 4);
                        outpointAndSequence = outpointAndSequence.toString('hex');
                        inputs.push(txhash + outpointAndSequence);
                    }
                    var script = tx.ins[i].script.toString('hex');
                    cordova.exec(function(result) {
                        d.resolve(result);
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "startUntrustedTransaction", [newTransaction, i, inputs, script]);
                    return d.promise;
                },
                gaUntrustedHashTransactionInputFinalizeFull_async: function(tx) {
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        d.resolve(result);
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "finalizeInputFull", [tx.serializeOutputs().toString('hex')]);
                    return d.promise;
                },
                signTransaction_async: function(path, transactionAuthorization, lockTime) {
                    var d = Q.defer();
                    cordova.exec(function(result) {
                        d.resolve(new ByteString(result, HEX));
                    }, function(fail) {
                        d.reject(fail);
                    }, "BTChip", "untrustedHashSign", [path, lockTime]);
                    return d.promise;
                }
            },
            dongle: dongle
        }
    }
    var pinModalCallbacks = [], pinNotCancelable = false, devnum = 0;
    return {
        _setupWrappers: function(btchip) {
            // wrap some functions to allow using them even after disconnecting the dongle
            // (prompting user to reconnect and enter pin)
            var service = this;
            var WRAP_FUNCS = [
                'gaStartUntrustedHashTransactionInput_async',
                'signMessagePrepare_async'
            ];
            for (var i = 0; i < WRAP_FUNCS.length; i++) { (function(func_name) {
                btchip[func_name] = function() {
                    var deferred = $q.defer();
                    var origArguments = arguments;
                    try {
                        var d = btchip.app[func_name].apply(btchip.app, arguments)
                    } catch (e) {
                        // handle `throw "Connection is not open"` gracefully - getDevice() below
                        var d = $q.reject();
                    }
                    d.then(function(data) {
                        deferred.resolve(data);
                    }, function(error) {
                        if (!error || !error.indexOf || error.indexOf('Write failed') != -1) {
                            notices.makeNotice('error', gettext('BTChip communication failed'));
                            // no btchip - try polling for it
                            service.getDevice().then(function(btchip_) {
                                btchip.app = btchip_.app;
                                btchip.dongle = btchip_.dongle;
                                deferred.resolve(btchip[func_name].apply(btchip, origArguments));
                            });
                        } else {
                            if (error.indexOf("6982") >= 0) {
                                btchip.app.pin_verified = false;
                                // setMsg("Dongle is locked - enter the PIN");
                                return service.promptPin('', function(err, pin) {
                                    if (!pin) {
                                        deferred.reject();
                                        return;
                                    }
                                    return btchip.app.verifyPin_async(new ByteString(pin, ASCII)).then(function() {
                                        var d = $q.defer();  // don't call two functions at once in pinModalCallbacks
                                        btchip[func_name].apply(btchip, origArguments).then(function(ret) {
                                            deferred.resolve();
                                            d.resolve(ret);
                                        })
                                        return d.promise;
                                    }).fail(function(error) {
                                        btchip.dongle.disconnect_async();
                                        if (error.indexOf("6982") >= 0) {
                                            notices.makeNotice("error", gettext("Invalid PIN"));
                                        } else if (error.indexOf("6985") >= 0) {
                                            notices.makeNotice("error", gettext("Dongle is not set up"));
                                        } else if (error.indexOf("6faa") >= 0) {
                                            notices.makeNotice("error", gettext("Dongle is locked - reconnect the dongle and retry"));
                                        } else {
                                            notices.makeNotice("error", error);
                                        }
                                        deferred.reject();
                                    });
                                });
                            } else if (error.indexOf("6985") >= 0) {
                                notices.makeMessage('error', gettext("Dongle is not set up"));
                                deferred.reject();
                            } else if (error.indexOf("6faa") >= 0) {
                                notices.makeMessage('error', gettext("Dongle is locked - remove the dongle and retry"));
                                deferred.reject();
                            }
                        }
                    });
                    return deferred.promise;
                }
            })(WRAP_FUNCS[i]) }
            return btchip;
        },
        promptPin: function(type, callback) {
            pinModalCallbacks.push({cb: callback, devnum: devnum});
            if (pinModalCallbacks.length > 1) return;  // modal already displayed
            var scope, modal;

            scope = angular.extend($rootScope.$new(), {
                pin: '',
                type: type,
                pinNotCancelable: pinNotCancelable
            });
            pinNotCancelable = false;

            modal = $uibModal.open({
                templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_btchip_pin.html',
                size: 'sm',
                windowClass: 'pinmodal',
                backdrop: 'static',
                keyboard: false,
                scope: scope
            });

            focus('btchipPinModal');

            return modal.result.then(
                function (res) {
                    var oldCallbacks = pinModalCallbacks.slice();
                    var d = $q.when();
                    for (var i = 0; i < oldCallbacks.length; i++) {
                        if (oldCallbacks[i].devnum == devnum) {
                            (function(i) { d = d.then(function() {
                                return oldCallbacks[i].cb(null, res);
                            }); })(i);
                        }
                    }
                    pinModalCallbacks = [];
                    return d;
                },
                function (err) {
                    var oldCallbacks = pinModalCallbacks.slice();
                    for (var i = 0; i < oldCallbacks.length; i++) {
                        oldCallbacks[i].cb(err);
                    }
                    pinModalCallbacks = [];
                }
            );
        },
        getDevice: function(noModal, modalNotDisableable, existing_device) {
            var service = this;
            var deferred = $q.defer();

            if (window.cordova && cordova.platformId == 'ios') return deferred.promise;
            if (!cardFactory && !window.cordova) return $q.reject();

            var modal, showModal = function() {
                if (!noModal && !modal) {
                    $rootScope.safeApply(function() {
                        options = {
                            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_usb_device.html',
                        };
                        if (modalNotDisableable) {
                            options.scope = angular.extend($rootScope.$new(), {
                                notCancelable: true
                            });
                            options.backdrop = 'static';
                            pinNotCancelable = true;
                        }
                        modal = $uibModal.open(options);
                        $injector.get('hw_detector').modal = modal;
                        modal.result.finally(function() {
                            $interval.cancel(tick);
                        });
                    });
                }
                if (noModal) {
                    if (noModal == 'retry') return;
                    $interval.cancel(tick);
                    deferred.reject();
                }
            };

            var check = cordovaReady(function() {
                if (existing_device) existing_promise = existing_device.app.getFirmwareVersion_async();
                else existing_promise = $q.reject();
                existing_promise.then(function() {
                    $interval.cancel(tick);
                    deferred.resolve(existing_device);
                }, function() {
                    if (window.cordova) {
                        var app_d = $q.defer(), app_promise = app_d.promise;
                        cordova.exec(function(result) {
                            if (result) {
                                var wrapper = new BTChipCordovaWrapper();
                                app_d.resolve({app: wrapper.app, dongle: wrapper.dongle});
                            } else showModal();
                        }, function(fail) {}, "BTChip", "has_dongle", []);
                    } else {
                        var app_promise = cardFactory.list_async().then(function(result) {
                            if (result.length) {
                                return cardFactory.getCardTerminal(result[0]).getCard_async().then(function(dongle) {
                                    devnum += 1;
                                    return {app: new BTChip(dongle), dongle: dongle, devnum: devnum};
                                });
                            } else {
                                cardFactoryBootloader.list_async().then(function(result) {
                                    if (result.length) {
                                        showUpgradeModal();
                                        $interval.cancel(tick);
                                    } else {
                                        showModal();
                                    }
                                });
                            }
                        });
                    }
                    app_promise.then(function(btchip) {
                        if (!btchip) { return; };
                        btchip.app.getFirmwareVersion_async().then(function(version) {
                            if (noModal) {
                                $interval.cancel(tick);
                            } else if (modal) {
                                modal.close();  // modal close cancels the tick
                            } else {
                                $interval.cancel(tick);
                            }
                            var features = {};
                            var firmwareVersion = version.firmwareVersion.bytes(0, 4);
                            if (firmwareVersion.toString(HEX) < '00010408') {
                                btchip.dongle.disconnect_async();
                                showUpgradeModal();
                                return;
                            }
                            features.signMessageRecoveryParam =
                                firmwareVersion.toString(HEX) >= '00010409';
                            features.quickerVersion =
                                firmwareVersion.toString(HEX) >= '0001040b';
                            deferred.resolve(service._setupWrappers({dongle: btchip.dongle,
                                                                     app: btchip.app,
                                                                     features: features}));
                        });
                    });
                });
            });
            var tick = $interval(check, 1000);
            check();

            return deferred.promise;

            function showUpgradeModal () {
                var notice = gettext("Old BTChip firmware version detected. Please upgrade to at least %s.").replace('%s', '1.4.8');
                if (window.cordova) {
                    notices.makeNotice("error", notice);
                } else {
                    var scope = angular.extend($rootScope.$new(), {
                        firmware_upgrade_message: notice
                    });
                    var modal = $uibModal.open({
                        templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_btchip_fup.html',
                        scope: scope
                    }).result.then(function() {
                        deferred.resolve(service.getDevice(noModal, modalNotDisableable, existing_device));
                    });
                }
            }
        },
        setupSeed: function(mnemonic) {
            var deferred = $q.defer();
            var service = this;

            this.getDevice().then(function(btchip_) {
                var scope = $rootScope.$new(),
                    wrong_pin, btchip = btchip_;
                scope.btchip = {
                    already_setup: false,
                    gait_setup: false,
                    use_gait_mnemonic: !!mnemonic,
                    storing: false,
                    seed_progress: 0,
                    reset: function() {
                        this.resetting = true;
                        this.resets_remaining = 3;
                        wrong_pin = '00000000000000000000000000000000';
                        var attempt = function() {
                            btchip.app.verifyPin_async(new ByteString(wrong_pin, ASCII)).then(function() {
                                wrong_pin = '1234';
                                attempt();
                            }).fail(function(error) {
                                $rootScope.$apply(function() {
                                    console.log('reset pin error ' + error);
                                    if (error.indexOf("6982") >= 0 || error.indexOf("63c") >= 0) {
                                        // setMsg("Dongle is locked - enter the PIN");
                                        if (error.indexOf("63c") >= 0) {
                                            scope.btchip.resets_remaining = Number.parseInt(error[error.indexOf("63c") + 3]);
                                        } else {
                                            scope.btchip.resets_remaining -= 1;
                                        }
                                    } else if (error.indexOf("6985") >= 0) {
                                        // var setupText = "Dongle is not set up";
                                        scope.btchip.resets_remaining = 0;
                                    }
                                    scope.btchip.replug_required = true;
                                    if (scope.btchip.resets_remaining) {
                                        service.getDevice('retry').then(function(btchip_) {
                                            btchip = btchip_;
                                            scope.btchip.replug_required = false;
                                            attempt();
                                        })
                                    } else {
                                        service.getDevice('retry').then(function(btchip_) {
                                            btchip = btchip_;
                                            scope.btchip.replug_required = false;
                                            scope.btchip.resetting = false;
                                            scope.btchip.already_setup = false;
                                        });
                                    }
                                });
                            });
                        };
                        attempt();
                    },
                    store: function() {
                        if (!mnemonic) {
                            this.setting_up = true;
                        } else {
                            this.storing = true;
                        }
                        service.promptPin('', function(err, pin) {
                            if (!pin) return;
                            if (mnemonic) seed_deferred = mnemonics.toSeed(mnemonic);
                            else seed_deferred = $q.when();
                            seed_deferred.then(function(seed) {
                                btchip.app.setupNew_async(
                                    0x01,  // wallet mode

                                    0x02 | // deterministic signatures
                                    0x08,  // skip second factor if consuming only P2SH inputs in a transaction

                                    cur_net.pubKeyHash,
                                    cur_net.scriptHash,
                                    new ByteString(pin, ASCII),
                                    undefined,  // wipePin

                                    // undefined,  // keymapEncoding
                                    // true,  // restoreSeed
                                    seed && new ByteString(seed, HEX) // bip32Seed
                                ).then(function() {
                                    btchip.app.setKeymapEncoding_async().then(function() {
                                        $rootScope.$apply(function() {
                                            scope.btchip.storing = scope.btchip.setting_up = false;
                                            scope.btchip.gait_setup = true;
                                            scope.btchip.replug_for_backup = !mnemonic;
                                            deferred.resolve({pin: pin});
                                        });
                                    }).fail(function(error) {
                                        notices.makeNotice('error', error);
                                        console.log('setKeymapEncoding_async error: ' + error);
                                    });
                                }).fail(function(error) {
                                    notices.makeNotice('error', error);
                                    console.log('setupNew_async error: ' + error);
                                });
                            }, null, function(progress) {
                                scope.btchip.seed_progress = progress;
                            });
                        });
                    }
                };
                var do_modal = function() {
                    $uibModal.open({
                        templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/wallet_modal_btchip_setup.html',
                        scope: scope
                    }).result.finally(function() {
                        btchip.dongle.disconnect_async();
                    });
                }
                btchip.app.getWalletPublicKey_async("").then(function(result) {
                    scope.btchip.already_setup = true;
                    do_modal();
                }).fail(function(error) {
                    if (error.indexOf("6982") >= 0) {
                        // setMsg("Dongle is locked - enter the PIN");
                        scope.btchip.already_setup = true;
                    } else if (error.indexOf("6985") >= 0) {
                        // var setupText = "Dongle is not set up";
                    } else if (error.indexOf("6faa") >= 0) {
                        // setMsg("Dongle is locked - remove the dongle and retry");
                        scope.btchip.already_setup = true;
                    }
                    do_modal();
                });
            });

            return deferred.promise;
        }
    }
}]).factory('bip38', ['$q', '$uibModal', 'mnemonics', 'focus', function($q, $uibModal, mnemonics, focus) {
    var bip38Service = {}, iframe;
    bip38Service.processMessage = function(message) {
        var is_chrome_app = window.chrome && chrome.storage;
        d = $q.defer();
        if (window.cordova) {
            var method, data, password = message.password;
            if (message.mnemonic_decrypted) {
                method = "encrypt_raw";
                data = message.mnemonic_decrypted;
            } else if (message.mnemonic_encrypted) {
                method = "decrypt_raw";
                data = message.mnemonic_encrypted;
            }
            cordovaReady(function() {
                cordova.exec(function(result) {
                    d.resolve({data: result});
                }, function(fail) {
                    d.reject(fail);
                }, "BIP38", method, [Array.from(data), password]);
            })();
        } else if (is_chrome_app) {
            var process = function() {
                var listener = function(message) {
                    window.removeEventListener('message', listener);
                    d.resolve(message);
                };
                window.addEventListener('message', listener);
                iframe.contentWindow.postMessage(message, '*');
            };
            if (!iframe) {
                if (document.getElementById("id_iframe_bip38_service")) {
                    iframe = document.getElementById("id_iframe_bip38_service");
                    process();
                } else {
                    iframe = document.createElement("IFRAME");
                    iframe.onload = process;
                    iframe.setAttribute("src", "/bip38_sandbox.html");
                    iframe.setAttribute("class", "ng-hide");
                    iframe.setAttribute("id", "id_iframe_bip38_service");
                    document.body.appendChild(iframe);
                }
            } else {
                process();
            }
        } else {
            var worker = new Worker("/static/js/greenwallet/signup/bip38_worker.js");
            worker.onmessage = function(message) {
                d.resolve(message);
            }
            worker.postMessage(message);
        }
        return d.promise;
    }
    bip38Service.encrypt_mnemonic_modal = function($scope, seed) {
        var d = $q.defer();
        $scope.encrypt_password_modal = {
            encrypt: function() {
                this.error = undefined;
                if (!this.password) {
                    this.error = gettext('Please provide a password.');
                    return;
                }
                if (this.password != this.password_repeated) {
                    this.error = gettext('Passwords do not match.');
                    return;
                }
                this.encrypting = true;
                var that = this;
                bip38Service.processMessage({password: that.password, mnemonic_decrypted: seed}).then(function(message) {
                    mnemonics.toMnemonic(message.data).then(function(mnemonic) {
                        that.encrypting = false;
                        d.resolve(mnemonic);
                        modal.close();
                    });
                });
            }
        };
        var modal = $uibModal.open({
            templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/signuplogin/modal_encryption_password.html',
            scope: $scope
        });
        modal.opened.then(function() { focus('encryptPasswordModal'); })
        return d.promise;
    };
    return bip38Service;
}]).factory('encode_key', ['$q', function($q) {
    var iframe;
    return function(key, passphrase) {
        var data = key.keyPair || key;  // either HDNode or ECPair
        if (!passphrase) {
            return $q.when(data.toWIF());
        } else {
            var is_chrome_app = window.chrome && chrome.storage;
            var d = $q.defer();
            if (window.cordova) {
                cordovaReady(function() {
                    cordova.exec(function(b58) {
                        d.resolve(b58);
                    }, function(fail) {
                        $rootScope.decrementLoading();
                        notices.makeNotice('error', fail);
                        d.reject(fail);
                    }, "BIP38", "encrypt", [
                        Array.from(data.d.toBuffer()),
                        passphrase,
                        (cur_net === Bitcoin.bitcoin.networks.bitcoin ?
                            'BTC' : 'BTT')]);
                })();
            } else if (is_chrome_app) {
                var process = function() {
                    var listener = function(message) {
                        window.removeEventListener('message', listener);
                        d.resolve(message.data);
                    };
                    window.addEventListener('message', listener);
                    iframe.contentWindow.postMessage({
                        eckey: data.toWIF(),
                        network: cur_net,
                        password: passphrase
                    }, '*');
                };
                if (!iframe) {
                    if (document.getElementById("id_iframe_send_bip38")) {
                        iframe = document.getElementById("id_iframe_send_bip38");
                        process();
                    } else {
                        iframe = document.createElement("IFRAME");
                        iframe.onload = process;
                        iframe.setAttribute("src", "/bip38_sandbox.html");
                        iframe.setAttribute("class", "ng-hide");
                        iframe.setAttribute("id", "id_iframe_send_bip38");
                        document.body.appendChild(iframe);
                    }
                } else {
                    process();
                }
            } else {
                var worker = new Worker("/static/js/greenwallet/signup/bip38_worker.js");
                worker.onmessage = function(message) {
                    d.resolve(message.data);
                }
                worker.postMessage({
                    eckey: data.toWIF(),
                    network: cur_net,
                    password: passphrase
                });
            }
            return d.promise;
        }
    };
}]);
