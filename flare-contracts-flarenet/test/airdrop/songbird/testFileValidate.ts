import BigNumber from "bignumber.js";

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const processFile = require('../../../airdrop/songbird/utils/processFile');
const LineItem = processFile.LineItem;

describe('Validate File testing for songbird', function() {
  const testLogPath = path.join(__dirname,  "temp")
  const testLogFile = testLogPath + "/test.txt"

  before(function() {
    fs.mkdir(testLogPath, (err:any) => {
      if (err) {
        return console.error(err);
      }
    });
  });

  after(function() {
    fs.rmdir(testLogPath, (err:any) => {
      if (err) {
        return console.error(err);
      }
    });
  });

  beforeEach(function() {
    fs.writeFile(testLogFile, '', function (err:any) {
      if (err) {
          return console.error("Can't create file at provided destination");
      };
    });
  });

  afterEach(function() {
    fs.unlinkSync(testLogFile);
  });

  const validData10 = [
    {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
    FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
    XRPBalance:"1286011173",
    FlareBalance:"1295399054562900000000"},
    {XRPAddress:"r11L3HhmYjTRVpueMwKZwPDeb6hBCSdBn",
    FlareAddress:"0x22577cc04c6ea5f0E1cdE6Bd2663761549995BA0",
    XRPBalance:"20599992",
    FlareBalance:"20750371941600000000"},
    {XRPAddress:"r12zYzJzTcf2j1BPsb5kUtZnLA1Wn7445",
    FlareAddress:"0x2a6687E2FDd6A66ac868Ac62ad12c01245e72CbB",
    XRPBalance:"555303008",
    FlareBalance:"559356719958400000000"},
    {XRPAddress:"r1398Fmwd1oYz8uUUbeQUE5axgXHjcfTZ",
    FlareAddress:"0x38eA655165Cc077a36E1f1Ed745c003DFE83875d",
    XRPBalance:"603499924",
    FlareBalance:"607905473445200000000"},
    {XRPAddress:"r13m9n9y7TVwFLfJnsMh1tGPRsXjMiaKh",
    FlareAddress:"0x8BA3b8041146Fb6769d76A900826bE705b1D669E",
    XRPBalance:"37999976",
    FlareBalance:"38277375824800000000"},
    {XRPAddress:"r14f8Luu4dYKzNEwFYV2KfA74YZcWVS5F",
    FlareAddress:"0x158E1998458203B4824241b9Bc178EA55c532a30",
    XRPBalance:"1399999700",
    FlareBalance:"1410219697810000000000"},
    {XRPAddress:"r14iqdWmMQD1M7ski2a1oL2yoL8saBrgS",
    FlareAddress:"0xd4D3e94c6A2059C3166D4Bd5a4421Af101394C7C",
    XRPBalance:"1026587825",
    FlareBalance:"1034081916122500000000"},
    {XRPAddress:"r15BXLNhkFuUP2jztomyDvzsxVLzYw7Yh",
    FlareAddress:"0x61BA6F4C8165E031da5443ACFcA9e804Fbe993C4",
    XRPBalance:"46702988",
    FlareBalance:"47043919812400000000"},
    {XRPAddress:"r15aAVY2acncVcTkShfQQ6ycAQS2b4yfa",
    FlareAddress:"0xd4E690b5DD199b64Dea5B8fc08fc79A7f2cF7E76",
    XRPBalance:"19999988",
    FlareBalance:"20145987912400000000"},
    {XRPAddress:"r16DDq7D5kbh7mY6oUWk73RMd2pHA9CKv",
    FlareAddress:"0x6cDE1C841812C3820C8A61B9be548f105dc15DDF",
    XRPBalance:"14031299960",
    FlareBalance:"14133728449708000000000"}
  ];

  const validDataDuplicateFLR = [
    {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
    FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
    XRPBalance:"1286011173",
    FlareBalance:"1295399054562900000000"},
    {XRPAddress:"r11L3HhmYjTRVpueMwKZwPDeb6hBCSdBn",
    FlareAddress:"0x2a6687E2FDd6A66ac868Ac62ad12c01245e72CbB",
    XRPBalance:"20599992",
    FlareBalance:"20750371941600000000"},
    {XRPAddress:"r12zYzJzTcf2j1BPsb5kUtZnLA1Wn7445",
    FlareAddress:"0x2a6687E2FDd6A66ac868Ac62ad12c01245e72CbB",
    XRPBalance:"555303008",
    FlareBalance:"559356719958400000000"},
  ];

  describe('Validating lines', function() {
    it('Should work just fine', function() {
      let processedFileData = processFile.validateFile(validData10,testLogFile, false);

      assert.equal(processedFileData.validAccounts.length, 10);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===true}).length, 10);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===false}).length, 0);
      assert.equal(processedFileData.validAccountsLen, 10);
      assert.equal(processedFileData.invalidAccountsLen, 0);
    });

    it('Should detect duplicated XRP address ', function() {
      let data = [
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
        FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
        XRPBalance:"1286011173",
        FlareBalance:"1295399054562900000000"},
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
        FlareAddress:"0x22577cc04c6ea5f0E1cdE6Bd2663761549995BA0",
        XRPBalance:"20599992",
        FlareBalance:"20750371941600000000"},
      ];
      let processedFileData = processFile.validateFile(data,testLogFile, false);

      assert.equal(processedFileData.validAccounts.length, 2);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===true}).length, 1);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===false}).length, 1);
      assert.equal(processedFileData.validAccountsLen, 1);
      assert.equal(processedFileData.invalidAccountsLen, 1);
    });

    it('Should detect invalid balance for XRP balance ', function() {
      let data = [
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
        FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
        XRPBalance:"1286011a173",
        FlareBalance:"1295399054562900000000"},
        {XRPAddress:"r11L3HhmYjTRVpueMwKZwPDeb6hBCSdBn",
        FlareAddress:"0x22577cc04c6ea5f0E1cdE6Bd2663761549995BA0",
        XRPBalance:"20599992",
        FlareBalance:"20750371941600000000"},
      ];
      let processedFileData = processFile.validateFile(data,testLogFile, false);

      assert.equal(processedFileData.validAccounts.length, 2);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===true}).length, 1);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===false}).length, 1);
      assert.equal(processedFileData.validAccountsLen, 1);
      assert.equal(processedFileData.invalidAccountsLen, 1);
    });

    it('Should detect invalid balance for FLR balance ', function() {
      let data = [
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
        FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
        XRPBalance:"1286011173",
        FlareBalance:"1295399054562900000000"},
        {XRPAddress:"r11L3HhmYjTRVpueMwKZwPDeb6hBCSdBn",
        FlareAddress:"0x22577cc04c6ea5f0E1cdE6Bd2663761549995BA0",
        XRPBalance:"20599992",
        FlareBalance:"20750371941a00000000"},
      ];
      let processedFileData = processFile.validateFile(data,testLogFile, false);

      assert.equal(processedFileData.validAccounts.length, 2);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===true}).length, 1);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===false}).length, 1);
      assert.equal(processedFileData.validAccountsLen, 1);
      assert.equal(processedFileData.invalidAccountsLen, 1);
    });

    it('Should detect invalid Flare account', function() {
      let data = [
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
        FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
        XRPBalance:"1286011173",
        FlareBalance:"1295399054562900000000"},
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ826c",
        FlareAddress:"0x22577cc04b6ea5f0E1cdE6Bd2663761549995BA0",
        XRPBalance:"20599992",
        FlareBalance:"20750371941600000000"},
      ];
      let processedFileData = processFile.validateFile(data,testLogFile, false);

      assert.equal(processedFileData.validAccounts.length, 2);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===true}).length, 1);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===false}).length, 1);
      assert.equal(processedFileData.validAccountsLen, 1);
      assert.equal(processedFileData.invalidAccountsLen, 1);
    });

    it('Should detect invalid XPR account', function() {
      let data = [
        {XRPAddress:"r11D6PPwznQcvNGCPbt7M27vguskJ827c",
        FlareAddress:"0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199",
        XRPBalance:"1286011173",
        FlareBalance:"1295399054562900000000"},
        {XRPAddress:"r11L3HhmYjTRVpueMwKZwPDeb6hBCSdBn",
        FlareAddress:"0x22577cc04c6ea5f0E1cdE6Bd2663761549995BA0",
        XRPBalance:"20599992",
        FlareBalance:"20750371941600000000"},
      ];
      let processedFileData = processFile.validateFile(data,testLogFile, false);

      assert.equal(processedFileData.validAccounts.length, 2);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===true}).length, 1);
      assert.equal(processedFileData.validAccounts.filter(function(x:any){return x===false}).length, 1);
      assert.equal(processedFileData.validAccountsLen, 1);
      assert.equal(processedFileData.invalidAccountsLen, 1);
    });
  });

  describe('Processing Data', function() {
    it('Should work just fine', function() {
      const contPer = new BigNumber(1);
      const conFact = new BigNumber(1.0073);
      const initAir = new BigNumber(1);
      const validatedFile = processFile.validateFile(validData10, testLogFile,false)
      const parsedFile = processFile.createFlareAirdropGenesisData(
        validData10,
        validatedFile,
        contPer,
        conFact,
        initAir,
        testLogFile,
        false);

      assert.equal(parsedFile.accountsDistribution.length,2);
      assert.equal(parsedFile.accountsDistribution[1],10);
      assert.equal(parsedFile.processedAccounts.length,10);
      assert.equal(parsedFile.processedAccountsLen,10);
    });

    it('Should join duplicate flare address ', function() {
      const contPer = new BigNumber(1);
      const conFact = new BigNumber(1.0073);
      const initAir = new BigNumber(1);
      const validatedFile = processFile.validateFile(validDataDuplicateFLR, testLogFile,false)
      const parsedFile = processFile.createFlareAirdropGenesisData(
        validDataDuplicateFLR,
        validatedFile,
        contPer,
        conFact,
        initAir,
        testLogFile,
        false);

      assert.equal(parsedFile.accountsDistribution.length,3);
      assert.equal(parsedFile.accountsDistribution[1],1);
      assert.equal(parsedFile.accountsDistribution[2],1);
      assert.equal(parsedFile.processedAccounts.length,2);
      assert.equal(parsedFile.processedAccountsLen,3);

      const processed_0 = parsedFile.processedAccounts[0];
      const processed_1 = parsedFile.processedAccounts[1];
      const expected_0 = new BigNumber(1295399054562900000000).toString(16)
      const e1 = new BigNumber(559356719958400000000);
      const e2 = new BigNumber(20750371941600000000);
      const expected_1 = e1.plus(e2).toString(16)
      if(processed_0.NativeAddress === "0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199"){
        assert.equal(processed_0.NativeBalance,expected_0);
      }
      else if (processed_0.NativeAddress === "0x2a6687E2FDd6A66ac868Ac62ad12c01245e72CbB") {
        assert.equal(processed_0.NativeBalance,expected_1);
      }
      if(processed_1.NativeAddress === "0x28Bcd249FFd09d3fAf8d014683C5db2a7ce36199"){
        assert.equal(processed_1.NativeBalance,expected_0);
      }
      else if (processed_1.NativeAddress === "0x2a6687E2FDd6A66ac868Ac62ad12c01245e72CbB") {
        assert.equal(processed_1.NativeBalance,expected_1);
      }
    });
  });

});