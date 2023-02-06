const Mustache = require('mustache');
const fs = require('fs');
const { forOwn, each, extend, get } = require('lodash');
const FormData = require('form-data');
const path = require('path');
const axios = require('axios');
const prepareRequest = require('./prepare-request');
const { ScriptRuntime, TestRuntime } = require('@usebruno/js');
const {
  bruToJson
} = require('./bru');
const {
  stripExtension
} = require('../utils/filesystem');
const chalk = require('chalk');

// override the default escape function to prevent escaping
Mustache.escape = function (value) {
  return value;
};

const getEnvVars = (environment = {}) => {
  const variables = environment.variables;
  if (!variables || !variables.length) {
    return {};
  }

  const envVars = {};
  each(variables, (variable) => {
    if(variable.enabled) {
      envVars[variable.name] = Mustache.escape(variable.value);
    }
  });

  return envVars;
};

const runSingleRequest = async function (filename, collectionPath, collectionVariables) {
  try {
    const bruContent = fs.readFileSync(filename, 'utf8');

    const bruJson = bruToJson(bruContent);
    const request = prepareRequest(bruJson.request);

    // make axios work in node using form data
    // reference: https://github.com/axios/axios/issues/1006#issuecomment-320165427
    if(request.headers && request.headers['content-type'] === 'multipart/form-data') {
      const form = new FormData();
      forOwn(request.data, (value, key) => {
        form.append(key, value);
      });
      extend(request.headers, form.getHeaders());
      request.data = form;
    }

    const envVars = getEnvVars({});

    if(request.script && request.script.length) {
      let script = request.script + '\n if (typeof onRequest === "function") {onRequest(__brunoRequest);}';
      const scriptRuntime = new ScriptRuntime();
      const result = scriptRuntime.runRequestScript(script, request, envVars, collectionVariables, collectionPath);
    }

    const response = await axios(request);

    const scriptFile = get(bruJson, 'request.script');
    if(scriptFile && scriptFile.length) {
      let script = scriptFile + '\n if (typeof onResponse === "function") {onResponse(__brunoResponse);}';
      const scriptRuntime = new ScriptRuntime();
      const result = scriptRuntime.runResponseScript(script, response, envVars, collectionVariables, collectionPath);
    }

    let testResults = [];
    const testFile = get(bruJson, 'request.tests');
    if(testFile && testFile.length) {
      const testRuntime = new TestRuntime();
      const result = testRuntime.runTests(testFile, request, response, envVars, collectionVariables, collectionPath);
      testResults = get(result, 'results', []);
    }

    console.log(chalk.blue(stripExtension(filename)) + chalk.dim(` (${response.status} ${response.statusText})`));
    if(testResults && testResults.length) {
      each(testResults, (testResult) => {
        if(testResult.status === 'pass') {
          console.log(chalk.green(`   ✔️ `) + chalk.dim(testResult.description));
        } else {
          console.log(chalk.red(`   ✘ `) + chalk.red(testResult.description));
        }
      });
    }
  } catch (err) {
    Promise.reject(err);
  }
};

module.exports = {
  runSingleRequest
};