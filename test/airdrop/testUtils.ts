let utils = require('../../airdrop/utils/utils');

// import {createFlareAirdropGenesisData, validateFile, LineItem} from "../scripts/utils/processFile";

describe('Utils testing', function() {
  describe('isBaseTenNumber test', function() {
    it('Regular numeric string: 154634', function() {
      let isNumRes = utils.isBaseTenNumber("154634");
      assert.equal(isNumRes, true);
    });

    it('Regular numeric string: 154t634', function() {
      let isNumRes = utils.isBaseTenNumber("154t634");
      assert.equal(isNumRes, false);
    });

    it('Regular numeric string: 00125', function() {
      let isNumRes = utils.isBaseTenNumber("00125");
      assert.equal(isNumRes, true);
    });

    it('Regular numeric string: fff', function() {
      let isNumRes = utils.isBaseTenNumber("fff");
      assert.equal(isNumRes, false);
    });

    it('Regular numeric string: 12a', function() {
      let isNumRes = utils.isBaseTenNumber("12a");
      assert.equal(isNumRes, false);
    });

    it('Regular numeric string: 1234567890', function() {
      let isNumRes = utils.isBaseTenNumber("1234567890");
      assert.equal(isNumRes, true);
    });
  });
});