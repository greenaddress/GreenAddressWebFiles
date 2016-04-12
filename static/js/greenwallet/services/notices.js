module.exports = factory;

factory.dependencies = ['$rootScope', '$timeout'];

function factory ($rootScope, $timeout) {
    var notices = $rootScope.notices = [];
    var noticesService = {};
    noticesService.makeError = makeError;
    noticesService.makeNotice = makeNotice;
    noticesService.setLoadingText = setLoadingText;

    var errorMessages = {
        notenoughmoney: gettext("Not enough money, you need ${missing_satoshis} more ${unit} to cover the transaction and fee")
    };

    return noticesService;

    function makeError ($scope, error) {
        // this is the error object directly from an API call
        if (error.error !== 'com.greenaddress.error') {
            console.warn('Non-greenaddress error passed to makeError');
            return noticesService.makeNotice('error', error.message || error.msg || error);
        }
        var code = getErrorCode(error);
        var message = error.args[1];
        var args = parseArgs(error.args[2] || {});

        if (code in errorMessages) {
            message = errorMessages[code];
        }
        message = decorateError(message, args);

        return noticesService.makeNotice('error', message);

        // we want the scope
        function parseArgs (args) {
            var div = {'BTC': 1, 'mBTC': 1000, 'µBTC': 1000000, 'bits':1000000};
            args.unit = $scope.wallet.unit;

            // special parsing rules
            if (args.missing_satoshis) {
                args.missing_satoshis = Math.round(args.missing_satoshis * div[$scope.wallet.unit]) / 100000000;
            }
            return args;
        }
    }
    function decorateError (message, args) {
        Object.keys(args).forEach(function (argName) {
            message = message.replace('${' + argName + '}', args[argName]);
        });
        return message;
    }
    function getErrorCode (error) {
        return error.args[0].substr(error.args[0].indexOf('#')+1);
    }

    function makeNotice (type, msg, timeout) {
        if (msg == null || msg.length == 0)
            return;

        console.log(msg);
        var is_chrome_app = window.chrome && chrome.storage;
        if (is_chrome_app) {
            var opt = {
                type: "basic",
                title: "GreenAddress Notification",
                message: msg,
                iconUrl: BASE_URL + "/static/img/logos/logo-greenaddress.png"
            };

            chrome.notifications.create("", opt);
        }

        var data = {
            type: type,
            msg: msg
        };
        notices.push(data);

        if (timeout == null)
            timeout = 5000;

        if (timeout > 0) {
            $timeout(function() {
                for (var i = 0; i < notices.length; ++i) {
                    if (notices[i] === data) {
                        notices.splice(i, 1);
                    }
                }
            }, timeout);
        }
    }
    function setLoadingText (text, ifNotSet) {
        if (!ifNotSet || !$rootScope.loading_text) {
            $rootScope.loading_text = text;
        }
    }
}