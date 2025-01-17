import * as fs from "./fs";
import VM from "./vm";

export { fs, VM };

import { Callback, Embark, Events, Logger } /* supplied by @types/embark in packages/embark-typings */ from "embark";
import Web3 from "web3";

const EmbarkJS = require("embarkjs");

export enum ProviderEventType {
  ProviderRegistered = "providerRegistered",
  ProviderSet = "providerSet",
}

export default class CodeRunner {
  private ready: boolean = false;
  private blockchainConnected: boolean = false;
  private logger: Logger;
  private events: Events;
  private vm: VM;
  private providerStates: { [key: string]: boolean } = {};
  constructor(embark: Embark, _options: any) {
    this.logger = embark.logger;
    this.events = embark.events;

    EmbarkJS.environment = embark.env;
    this.vm = new VM({
      require: {
        mock: {
          fs,
        },
      },
      sandbox: {
        EmbarkJS,
        Web3,
      },
    }, this.logger);

    this.registerEvents();
    this.registerCommands();
  }

  private generateListener(provider: string, eventType: ProviderEventType) {
    const providerStateName = `${provider}:${eventType}`;
    const eventName = `runcode:${providerStateName}`;
    this.events.setCommandHandler(eventName, (cb) => {
      if (this.providerStates[providerStateName] === true) {
        return cb();
      }
      this.events.once(eventName, cb);
    });
  }

  private registerEvents() {
    this.events.on("runcode:register", this.registerVar.bind(this));
  }

  private registerCommands() {
    this.events.setCommandHandler("runcode:getContext", (cb) => {
      cb(this.vm.options.sandbox);
    });
    this.events.setCommandHandler("runcode:eval", this.evalCode.bind(this));
    this.events.setCommandHandler("runcode:embarkjs:reset", (cb) => {
      this.resetEmbarkJS(cb);
    });
    this.events.on("contractsDeployed", () => {
      this.events.on("code-generator-ready", (_modifiedAssets: any) => {
        this.resetEmbarkJS();
      });
    });

    // register listeners for when EmbarkJS runs registerProvider through the console.
    // For example, when `EmbarkJS.Storage.registerProvider(...)` is run through the console,
    // emit the `runcode:storage:providerRegistered` event, and fire any requests attached to it
    Object.keys(EmbarkJS)
      .filter((propName) => EmbarkJS[propName].hasOwnProperty("registerProvider"))
      .forEach((providerName) => {
        this.generateListener(providerName.toLowerCase(), ProviderEventType.ProviderRegistered);
      });

    // register listeners for when EmbarkJS runs setProvider through the console.
    // For example, when `EmbarkJS.Storage.setProvider(...)` is run through the console,
    // emit the `runcode:storage:providerSet` event, and fire any requests attached to it
    Object.keys(EmbarkJS)
      .filter((propName) => EmbarkJS[propName].hasOwnProperty("setProvider"))
      .forEach((providerName) => {
        this.generateListener(providerName.toLowerCase(), ProviderEventType.ProviderSet);
      });
  }

  private resetEmbarkJS(cb?: Callback<null>) {
    this.events.request("code-generator:embarkjs:init-provider-code", (code: string) => {
      this.evalCode(code, (err) => {
        if (err) {
          console.dir(err);
          return;
        }
        this.events.request("code-generator:embarkjs:set-provider-code", (providerCode: string) => {
          this.evalCode(providerCode, (errInitProvider, _result) => {
            if (cb) { cb(errInitProvider); }
          }, false);
        });
      }, false);
    });
  }

  private registerVar(varName: string, code: any, cb = () => { }) {
    this.vm.registerVar(varName, code, cb);
  }

  private evalCode(code: string, cb: Callback<any>, tolerateError = false) {
    cb = cb || (() => { });

    if (!code) {
      return cb(null, "");
    }

    this.vm.doEval(code, tolerateError, (err, result) => {
      if (err) {
        return cb(err);
      }

      cb(null, result);
    });
  }
}
