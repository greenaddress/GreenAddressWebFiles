var window = require('global/window');
var angular = require('angular');

var gettext = window.gettext;

module.exports = factory;

factory.dependencies = ['$rootScope', 'tx_sender', 'storage', 'storage_keys', 'crypto', 'notices', '$q'];

function factory ($rootScope, tx_sender, storage, storage_keys, crypto, notices, $q) {
  var PER_PAGE = 15;
  return {
    items: [],
    reverse: {},
    new_item: undefined,
    populate_csv: function () {
      var csv_list = [];
      for (var i = 0; i < this.items.length; i++) {
        var item = this.items[i];
        csv_list.push(item.name + ',' + (item.href || item.address));
      }
      this.csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv_list.join('\n'));
    },
    init_partitions: function (items) {
      var next_prefix;
      var next_partition;
      var i;
      var items_copy = [];
      items = items || this.items;

      for (i = 0; i < items.length; i++) {
        items_copy.push(items[i]);
      }
      this.partitions = [];
      var get_name = function (item) {
        // works with 'unprocessed' and 'processed' items
        if (item.name) return item.name;
        else return item[0];
      };
      while (items_copy.length) {
        var prefix = next_prefix || get_name(items_copy[0])[0];
        var partition = next_partition || [];
        for (i = 0; i < PER_PAGE; i++) {
          if (!items_copy.length) break;
          var next_item = this._process_item(items_copy.shift());
          if (next_item) partition.push(next_item);
          else i -= 1; // crx facebook
        }
        if (items_copy.length) {
          next_prefix = get_name(items_copy[0])[0];
          next_partition = [];
          while (next_prefix === partition[partition.length - 1].name.substring(0, next_prefix.length) &&
            next_prefix.length < get_name(items_copy[0]).length) {
            next_prefix += get_name(items_copy[0])[next_prefix.length];
            if (next_prefix.length === 3) {
              while (partition.length &&
                partition[partition.length - 1].name.substring(0, 3) === next_prefix) {
                next_partition.push(partition.pop());
              }
              break;
            }
          }
        }
        if (partition.length) {
          this.partitions.push([this.partitions.length + 1, prefix, partition]);
        }
      }
    },
    _process_item: function (value) {
      var is_chrome_app = require('has-chrome-storage');
      if (value.name) {
        return value;
      }
      if (value[3] === 'facebook') {
        var has_wallet = value[4];
        if (!has_wallet && (is_chrome_app || window.cordova)) return; // can't send FB messages from Chrome/Cordova app
        var href = 'https://www.facebook.com/' + value[1];
        return {name: value[0], type: value[3], address: value[1], has_wallet: has_wallet, href: href};
      } else {
        return {name: value[0], type: value[3], has_wallet: value[4], address: value[1]};
      }
    },
    update_with_items: function (items, $routeParams) {
      while (this.items.length) this.items.pop();
      this.reverse = {};
      if (!$routeParams) $routeParams = {};
      var that = this;
      items.sort(function (a, b) { return a[0].localeCompare(b[0]); });
      this.init_partitions(items);
      var i = 0;
      angular.forEach(items, function (value) {
        var item = that._process_item(value);
        if (!item) return; // crx facebook
        if (value[3] !== 'facebook') {
          that.reverse[value[1]] = value[0];
        }
        that.items.push(item);
        if (value[0] === $routeParams.name) $routeParams.page = Math.ceil((i + 1) / PER_PAGE);
        i += 1;
      });
      that.num_pages = Math.ceil(that.items.length / 20);
      that.pages = [];
      for (i = 1; i <= that.num_pages; i++) that.pages.push(i);
      that.populate_csv();
    },
    load: function ($scope, $routeParams) {
      var addressbook_key = storage_keys.ADDRBOOK_CACHE.replace(
        '%s', $scope.wallet.receiving_id
      );
      var that = this;
      return storage.get(addressbook_key).then(function (cache) {
        try {
          cache = JSON.parse(cache) || {};
        } catch (e) {
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
          d = crypto.decrypt(cache.items, $scope.wallet.cache_password).then(function (decrypted) {
            that.update_with_items(JSON.parse(decrypted).concat(subaccounts), $routeParams);
          });
          var requires_load = false;
        } else {
          $rootScope.is_loading += 1;
          d = $q.when();
          requires_load = true;
        }

        return d.then(function () {
          return tx_sender.call('http://greenaddressit.com/addressbook/read_all', cache.hashed).then(function (data) {
            if (data.items) {
              var items = data.items;
              crypto.encrypt(JSON.stringify(data.items), $scope.wallet.cache_password).then(function (encrypted) {
                cache.items = encrypted;
                cache.hashed = data.hashed;
                storage.set(addressbook_key, JSON.stringify(cache));
              });
              that.update_with_items(items.concat(subaccounts), $routeParams);
            }
          }, function (err) {
            notices.makeNotice('error', gettext('Error reading address book: ') + err.args[1]);
          }).finally(function () {
            if (requires_load) {
              $rootScope.decrementLoading();
            }
          });
        });
      });
    }
  };
}
