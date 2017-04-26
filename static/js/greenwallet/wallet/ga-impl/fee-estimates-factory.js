var extend = require('xtend/mutable');

module.exports = GAFeeEstimatesFactory;

extend(GAFeeEstimatesFactory.prototype, {
  getFeeEstimate: getFeeEstimate
});

function GAFeeEstimatesFactory (gaService, initialEstimates, minFee) {
  this.gaService = gaService;
  this.estimates = initialEstimates;
  this.minFee = minFee;
  var _this = this;
  gaService.addNotificationCallback('feeEstimates', function (event) {
    _this.estimates = event[0];
  });
}

function getFeeEstimate (isInstant, confs) {
  var sortedEstimates = Object.keys(this.estimates).sort(
    function (a, b) {
      return +a - +b;
    }
  );

  for (var i = 0; i < sortedEstimates.length; ++i) {
    var estimate = this.estimates[sortedEstimates[i]];
    var feeRate = +estimate['feerate'];
    if (feeRate < 0) {
      continue;
    }
    var actualBlock = +estimate['blocks'];
    if (isInstant) {
      if (actualBlock <= 2) {
        return [feeRate * 1.1 * 1000 * 1000 * 100, actualBlock];
      }
      break;
    } else if (actualBlock < confs) {
      continue;
    }
    return [feeRate * 1000 * 1000 * 100, actualBlock];
  }

  if (isInstant && this.gaService.getNetName() === 'mainnet') {
    throw new Error('Instant transactions not available at this time. Please try again later.');
  }

  return [this.gaService.getMinFeeRate() * (isInstant ? 3 : 1), 1];
}
