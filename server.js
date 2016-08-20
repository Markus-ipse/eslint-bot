// Dependencies
const atob = require('atob');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const GitHubApi = require('github');
const _ = require('lodash');
const cardinal = require('cardinal');
const ESLintCLIEngine = require('eslint').CLIEngine;
const eslintConfig = require('./target-eslint-config.json');

const hl = (code) => console.log(cardinal.highlight(JSON.stringify(code), { json: true }));

// Github configuration
const github = new GitHubApi({
    version: '3.0.0',
    headers: {
        'user-agent': 'ESLint-bot', // GitHub is happy with a unique user agent
    },
    Promise: global.Promise,
});


// Eslint configuration
const eslint = new ESLintCLIEngine(eslintConfig);
console.log('Eslint will be run with the following config');
hl(eslintConfig);

const filterJavascriptFiles = (files) =>
    files.filter(({ filename }) => filename.match(process.env.FILE_FILTER));

const getContent = (file, ref, prNumber) => {
    const { filename, patch, sha } = file;
    // Todo: Can be rewritten without manually resolving or rejecting?
    return new Promise((resolve, reject) => {
        github.repos.getContent({
            user: process.env.REPOSITORY_OWNER,
            repo: process.env.REPOSITORY_NAME,
            path: filename,
            ref,
        }, (error, data) => {
            if (error) {
                console.error(error);
                reject(error);
            } else {
                resolve({
                    filename,
                    patch,
                    sha,
                    prNumber,
                    content: atob(data.content),
                });
            }
        });
    });
};

/**
 * Compute a mapping object for the relationship:
 * 'file line number' <-> 'Github's diff view line number'.
 * This is necessary for the comments, as Github API asks to specify the line
 * number in the diff view to attach an inline comment to.
 * If a file line is not modified, then it will not appear in the diff view,
 * so it is not taken into account here.
 * The linter will therefore only mention warnings for modified lines.
 * @param  {String}   patchString               The git patch string.
 * @return {Object} An object shaped as follows : {'file line number': 'diff view line number'}.
 */
const getLineMapFromPatchString = (patchString) => {
    let diffLineIndex = 0;
    let fileLineIndex = 0;
    return patchString.split('\n').reduce((lineMap, line) => {
        if (line.match(/^@@.*/)) {
            fileLineIndex = line.match(/\+[0-9]+/)[0].slice(1) - 1;
        } else {
            diffLineIndex++;
            if (line[0] !== '-') {
                fileLineIndex++;
                if (line[0] === '+') {
                    lineMap[fileLineIndex] = diffLineIndex; // eslint-disable-line no-param-reassign
                }
            }
        }
        return lineMap;
    }, {});
};

/**
 * Lint a raw content passed as a string, then return the linting messages.
 * @param  {String} filename File filename
 * @param  {String} patch    Commit's Git patch
 * @param  {String} content  File content
 * @param  {String} sha      Commit's id
 * @return {Array}  Linting messages
 */
const lintContent = ({ filename, patch, content, sha, prNumber }) => {
    return {
        filename,
        lineMap: getLineMapFromPatchString(patch),
        messages: _.get(eslint.executeOnText(content, filename), 'results[0].messages'),
        sha,
        prNumber,
    };
};

/**
 * Send a comment to Github's commit view
 * @param  {String} filename File filename
 * @param  {Object} lineMap  The map between file and diff view line numbers
 * @param  {String} ruleId ESLint rule id
 * @param  {String} message  ESLint message
 * @param  {Integer} line  Line number (in the file)
 * @param  {String} sha      Commit's id
 */
const sendSingleComment = (filename, lineMap, { ruleId = 'Eslint', message, line }, sha, prNumber, numComment) => {
    const diffLinePosition = lineMap[line];
    // By testing this, we skip the linting messages related to non-modified lines.
    if (diffLinePosition) {
        console.log('Sending comment', numComment + 1);
        hl({
            user: process.env.REPOSITORY_OWNER,
            repo: process.env.REPOSITORY_NAME,
            number: prNumber,
            path: filename,
            commit_id: sha,
            body: `**${ruleId}**: ${message}`,
            position: diffLinePosition,
        });
        github.pullRequests.createComment({
            user: process.env.REPOSITORY_OWNER,
            repo: process.env.REPOSITORY_NAME,
            number: prNumber,
            body: `**${ruleId}**: ${message}`,
            commit_id: sha,
            path: filename,
            position: diffLinePosition,
        })
            .then(
                (...args) => console.log('then args >>>>', numComment + 1,...args),
                (...args) => console.log('catch args >>>>', numComment + 1, ...args)
            );
    } else {
        console.log('skipping', numComment + 1);
    }
};

/**
 * Send the comments for all the linting messages, to Github
 * @param  {String} filename File filename
 * @param  {Object} lineMap  The map between file and diff view line numbers
 * @param  {Array} messages  ESLint messages
 * @param  {String} sha      Commit's id
 */
const sendComments = ({ filename, lineMap, messages, sha, prNumber }) => {
    console.log('Messages to send:', messages.length);
    messages.forEach((message, i) => sendSingleComment(filename, lineMap, message, sha, prNumber, i));
};

function treatPayload(payload) {
    const { number, pull_request } = payload;
    github.pullRequests.getFiles({
        user: process.env.REPOSITORY_OWNER,
        repo: process.env.REPOSITORY_NAME,
        number,
    }).then((files) => {
        const jsFiles = filterJavascriptFiles(files);
        const lintedAndCommented = jsFiles.map((file) => (
            getContent(file, pull_request.head.ref, number)
                .then(lintContent)
                .then(sendComments))
        );

        Promise.all(lintedAndCommented).then(() => console.log('All files linted'));
    });
}

// Server
app.use(bodyParser.json());

app.set('port', (process.env.PORT || 5000));

app.post('/', ({ body: payload }, response) => {
    if (payload && payload.pull_request) {
        treatPayload(payload);
    }
    console.log(process.env.GITHUB_USERNAME, ': Received request');
    response.end();
});


const requiredVars = ['GITHUB_USERNAME', 'GITHUB_PASSWORD', 'REPOSITORY_OWNER', 'REPOSITORY_NAME'];
function isReadyToStart() {
    const setVars = requiredVars.filter((varName) => process.env[varName]);
    const stillMissing = requiredVars.filter((varName) => !process.env[varName]);

    const setVarsOutput = setVars.map((varName) => (
        varName === 'GITHUB_PASSWORD' ?
            `* ${varName} = ********` :
            `* ${varName} = ${process.env[varName]}`
    )).join('\n');
    console.log(`Set variables:\n${setVarsOutput}`);

    if (stillMissing.length > 0) {
        console.log('Still waiting for following env vars to be set:', stillMissing.join(', '));
    }
    return stillMissing.length === 0;
}

function startApp() {
    if (isReadyToStart()) {
        github.authenticate({
            type: 'basic',
            username: process.env.GITHUB_USERNAME,
            password: process.env.GITHUB_PASSWORD,
        });

        app.listen(app.get('port'), () => {
            console.log(process.env.GITHUB_USERNAME, 'is running on port', app.get('port'));
        });
    } else {
        setTimeout(startApp, 2000);
    }
}

startApp();
