// replace this with an app object of some sort?
var deps = ['duScroll', 'ngAnimate', 'greenWalletServices'];
if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    deps.push('ngTouch');
    window.IS_MOBILE = true;
}
var app = angular.module('greenWalletBaseApp', deps);

module.exports = app;

app.config(['$interpolateProvider', '$httpProvider',
        function config($interpolateProvider, $httpProvider) {
    // don't conflict with Django templates
    $interpolateProvider.startSymbol('((');
    $interpolateProvider.endSymbol('))');

    // show loading indicator on http requests
    $httpProvider.interceptors.push(['$q', '$rootScope', '$timeout', 'notices',
            function($q, $rootScope, $timeout, notices) {
        $rootScope.decrementLoading = function() {
            if ($rootScope.is_loading > 0) $rootScope.is_loading -= 1;
        }
        return {
            'request': function(config) {
                if (config.no_loading_indicator) return config || $q.when(config);
                if (!$rootScope.is_loading) $rootScope.is_loading = 0;
                notices.setLoadingText('Loading', true);  // for requests without setLoadingText
                $rootScope.is_loading += 1;
                return config || $q.when(config);
            },
            'response': function(response) {
                if (response.config.no_loading_indicator) return response || $q.when(response);
                if (!$rootScope.is_loading) $rootScope.is_loading = 1;
                $rootScope.decrementLoading();
                notices.setLoadingText();  // clear it (it's one-off)
                return response || $q.when(response);
            },
            'responseError': function(rejection) {
                if (!$rootScope.is_loading) $rootScope.is_loading = 1;
                $rootScope.decrementLoading();
                notices.setLoadingText();  // clear it (it's one-off)
                return $q.reject(rejection);
            }
        };
    }]);

    $httpProvider.defaults.xsrfCookieName = 'csrftoken';
    $httpProvider.defaults.xsrfHeaderName = 'x-csrftoken';
}]).config(['$compileProvider', function($compileProvider) {
    if (window.cordova) {
        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|bitcoin|data|file):/);
    } else if (window.chrome && chrome.storage) {
        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|bitcoin|data|chrome-extension):/);
    } else {
        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|ftp|mailto|bitcoin|data):/);
    }
}
]).run(['$rootScope', function run($rootScope) {
    $rootScope.LANG = LANG;
    $rootScope.safeApply = function(fn) {  // required for 'invalid' event handling
        var phase = this.$root.$$phase;
        if(phase == '$apply' || phase == '$digest') {
            if(fn && (typeof(fn) === 'function')) {
                fn();
            }
        } else {
            this.$apply(fn);
        }
    };

    // globally expose the root scope so that we can easily modify it
    window.$rootScope = $rootScope;
}]).factory('btc_formatter', ['$filter', function($filter) {
    var formatNum = function(num) {
        var num_arr = num.split('.');
        var x = '';
        for (var i = 0; i < num_arr[0].length; i++) {
            i = parseInt(i);
            x += num_arr[0][i];
            if (num_arr[0].length > (i + 1) && (num_arr[0].length - i - 1) % 3 == 0) x += ',';
        }
        return x + '.' + num_arr[1];
    }
    return function btc_formatter(satoshis, unit) {
        var mul = {'bits': '1000000', 'µBTC': '1000000', 'mBTC': '1000', 'BTC': '1'};
        if (mul[unit] === undefined) {
            // power of 10 specified by format_asset - if 8, then treat like BTC,
            // for lower, move the decimal place by `8 - unit` places right
            mul[unit] = '' + Math.pow(10, 8 - unit);
        }
        satoshis = (new Bitcoin.BigInteger((satoshis || 0).toString())).multiply(new Bitcoin.BigInteger(mul[unit] || mul['µBTC']));
        if (satoshis.compareTo(new Bitcoin.BigInteger('0')) < 0) {
            return '-'+formatNum(Bitcoin.Util.formatValue(satoshis.multiply(new Bitcoin.BigInteger('-1'))));
        } else {
            return formatNum(Bitcoin.Util.formatValue(satoshis));
        }
    };
}]).filter('format_btc', ['btc_formatter', function(btc_formatter) {
    return function format_btc(satoshis, unit) {
        if (!satoshis) return '0 ' + unit;
        return btc_formatter(Math.round(satoshis), unit) + ' ' + unit;
    };
}]).filter('format_btc_floor', ['btc_formatter', function(btc_formatter) {
    return function format_btc(satoshis, unit) {
        if (!satoshis) return '0 ' + unit;
        var num = btc_formatter(Math.round(satoshis), unit).split('.')[0];  // strip the fractional part
        return num + ' ' + unit;
    };
}]).filter('format_btc_nounit', ['btc_formatter', function(btc_formatter) {
    return function format_btc_nounit(satoshis, unit) {
        return btc_formatter(Math.round(satoshis), unit);
    };
}]).filter('format_fiat', [function() {
    return function format_fiat(satoshis, wallet_fiat) {
        wallet_fiat = JSON.parse(wallet_fiat);
        var value = satoshis * wallet_fiat.rate / (1000*1000*100);
        return (Math.round(value * 100) / 100) + ' ' + wallet_fiat.currency;
    }
}]).filter('format_decimal', ['btc_formatter', function(btc_formatter) {
    return function format_asset(satoshis, asset) {
        if (!asset) return '';
        if (!asset.btc_unit) {
            return btc_formatter(satoshis, asset.decimalPlaces) + ' ' + asset.name;
        }
        if (!satoshis) return '0 ' + asset.btc_unit;
        return btc_formatter(Math.round(satoshis), asset.btc_unit) + ' ' + asset.btc_unit;
    }
}]).filter('startFrom', function() {
    return function(input, start) {
        if (!input) return input;
        start = ~~start; //parse to int
        return input.slice(start);
    };
}).factory('$exceptionHandler', ['$injector', '$log', function($injector, $log) {
  return function (exception, cause) {
      if (typeof exception == "string") {
          $injector.get('notices').makeNotice('error', exception);
      } else {
          $log.error.apply($log, arguments);
      }
  };
}]);
