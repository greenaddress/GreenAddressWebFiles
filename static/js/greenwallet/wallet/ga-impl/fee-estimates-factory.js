var extend = require('xtend/mutable');

module.exports = GAFeeEstimatesFactory;

extend(GAFeeEstimatesFactory.prototype, {
  getFeeEstimate: getFeeEstimate
});

function GAFeeEstimatesFactory (gaService, curEstimates) {
  this.gaService = gaService;
}

function getFeeEstimate (confs) {
  // TODO: real values
  return [10000, 1];
}