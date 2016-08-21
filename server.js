const atob = require('atob');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const GitHubApi = require('github');
const _ = require('lodash');
const ESLintCLIEngine = require('eslint').CLIEngine;
const eslintConfig = require('./target-eslint-config.json');

// Github configuration
const github = new GitHubApi({
    version: '3.0.0',
    headers: {
        'user-agent': 'esLint-bot', // GitHub is happy with a unique user agent
    },
    Promise: global.Promise,
});


// Eslint configuration
const eslint = new ESLintCLIEngine(eslintConfig);

const env = (name) => process.env[name];

function filterJavascriptFiles(files) {
    return files.filter(({ filename }) => filename.match(env('FILE_FILTER')));
}

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
function getLineMapFromPatchString(patchString) {
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
}

/**
 * Send a comment to Github's commit view
 * @param  {String} filename File filename
 * @param  {Object} lineMap  The map between file and diff view line numbers
 * @param  {Object} lintError  Lint error
 * @param  {String} sha      Commit's id
 * @param  {Number} prNumber   Pull request number
 */
function sendSingleComment({ filename, lineMap, lintError, sha, prNumber }) {
    const { message, line } = lintError;
    const diffLinePosition = lineMap[line];
    // By testing this, we skip the linting messages related to non-modified lines.
    if (diffLinePosition) {
        // return console.log('Lint error on line:', diffLinePosition, message);
        github.pullRequests.createComment({
            user: env('REPOSITORY_OWNER'),
            repo: env('REPOSITORY_NAME'),
            number: prNumber,
            body: message,
            commit_id: sha,
            path: filename,
            position: diffLinePosition,
        });
    }
}

function groupLintErrorsByLine(lintErrors) {
    return lintErrors.reduce((acc, lintError) => {
        const { ruleId = 'Eslint', message, line } = lintError;
        const key = '.' + line; // eslint-disable-line prefer-template

        if (!acc[key]) {
            acc[key] = { line, message: '' }; // eslint-disable-line no-param-reassign
        }

        acc[key].message = [acc[key].message]  // eslint-disable-line no-param-reassign
            .concat(`**${ruleId}**: ${message}`)
            .join('\n');

        return acc;
    }, {});
}

function lintContent(content) {
    return _.get(eslint.executeOnText(content), 'results[0].messages');
}

function getContent(file, ref) {
    const { filename } = file;

    return github.repos.getContent({
        user: env('REPOSITORY_OWNER'),
        repo: env('REPOSITORY_NAME'),
        path: filename,
        ref,
    }).then((data) => atob(data.content));
}

function treatPayload(payload) {
    const { number, pull_request } = payload;

    github.pullRequests.getFiles({
        user: env('REPOSITORY_OWNER'),
        repo: env('REPOSITORY_NAME'),
        number,
    }).then((files) => {
        const jsFiles = filterJavascriptFiles(files);

        jsFiles.forEach((file) => {
            const sendComments = (errorsByLine) => {
                Object.keys(errorsByLine).forEach((line) => (
                    sendSingleComment({
                        filename: file.filename,
                        lineMap: getLineMapFromPatchString(file.patch),
                        lintError: errorsByLine[line],
                        sha: pull_request.head.sha,
                        prNumber: number,
                    })
                ));
            };

            getContent(file, pull_request.head.ref)
                .then(lintContent)
                .then(groupLintErrorsByLine)
                .then(sendComments);
        });
    });
}

// Server
app.use(bodyParser.json());

app.set('port', (env('PORT') || 5000));

app.post('/', ({ body: payload }, response) => {
    const openedOrReopened = payload.action === 'opened' || payload.action === 'reopened';
    if (payload && payload.pull_request && openedOrReopened) {
        /* eslint-disable no-console */
        console.log('A pull request was opened. Starting to lint content..');
        /* eslint-enable no-console */
        treatPayload(payload);
    }
    response.end();
});


const requiredVars = ['GITHUB_USERNAME', 'GITHUB_PASSWORD', 'REPOSITORY_OWNER', 'REPOSITORY_NAME'];
function isReadyToStart() {
    const definedVariables = requiredVars.filter((varName) => env(varName));
    const stillMissing = requiredVars.filter((varName) => !env(varName));

    const definedVars = definedVariables.map((varName) => (
        varName === 'GITHUB_PASSWORD' ? `* ${varName} = ********` : `* ${varName} = ${env(varName)}`
    )).join('\n');

    console.log(`Defined variables:\n${definedVars}`); // eslint-disable-line no-console

    if (stillMissing.length > 0) {
        /* eslint-disable no-console */
        console.log('Still waiting for following env vars to be set:', stillMissing.join(', '));
        /* eslint-enable no-console */
    }
    return stillMissing.length === 0;
}

(function startApp() {
    if (isReadyToStart()) {
        github.authenticate({
            type: 'basic',
            username: env('GITHUB_USERNAME'),
            password: env('GITHUB_PASSWORD'),
        });
        app.listen(app.get('port'), () => {
            /* eslint-disable no-console */
            console.log('ESLint-bot is running on port', app.get('port'));
            /* eslint-enable no-console */
        });
    } else {
        setTimeout(startApp, 2000);
    }
}());
