const axios = require('axios').default;
const columnify = require('columnify');

const MAXIMUM_TESTS_PER_BATCH = 10;
const MINIMUM_INTERVAL_BETWEEN_BATCH_EXECUTION_IN_MS = (10 * 1000);
const INTERVAL_BETWEEN_TEST_VERIFICATIONS_IN_MS = (10 * 1000);
const INTERVAL_BETWEEN_FETCH_TESTS_IDS_FROM_RUNSCOPE_IN_MS = (2 * 1000);
const INTERVAL_BETWEEN_TEST_VERIFICATION_RETRY = 3000;

let bucketKey = '';
let environmentId = '';
let runscopeApiKey = '';

let finishedTestIds = [];
let finishedTestResults = {};
let testNames = {};
let readingTestsFromArgs = false;
let fromArgsTestIds = [];

(async () => {
    parseArguments();
    validateArguments();

    const environmentData = await fetchEnvironmentData();
    printSharedEnvironmentVariables(environmentData.initialTestVariables);

    let testsIds;
    if(readingTestsFromArgs) {
        testsIds = fromArgsTestIds;
        console.log('Test list source: Argument list in -tests.');
    }
    else {
        testsIds = await fetchTestListFronRunscope();
        console.log('Test list source: Runscope API Test List.');
    }

    console.log(`\nTriggering execution of ${testsIds.length} tests in environment: ${environmentData.environmentName}`);

    const runningTestIds = await runTestsInBatches(testsIds, MAXIMUM_TESTS_PER_BATCH);
    startVerificationOnTests(runningTestIds);
})();

async function fetchTestListFronRunscope() {
    console.log(`Starting to fetch test list from Runscope API.`);
    const triggerUrlRegex = /https:\/\/api\.runscope\.com\/radar\/([0-9a-f]{8}\-[0-9a-f]{4}\-[0-9a-f]{4}\-[0-9a-f]{4}\-[0-9a-f]{12})\/trigger/;
    let testList = [];
    let runnableTestsCount = 0;
    let ignoredTestsCount = 0;
    let noRemainingTestsToFetch = false;
    let nextOffsetToFetch = 0;
    while(noRemainingTestsToFetch == false) {
        let runscopeAttempts = 0;
        let testListFetchedWithSuccess = false;
        while(testListFetchedWithSuccess == false && runscopeAttempts < 3) {
            try {
                runscopeAttempts ++;

                const testListResponse = await axios.get(`https://api.runscope.com/buckets/${bucketKey}/tests?offset=${nextOffsetToFetch}`, {
                    headers: {
                        'Authorization': `Bearer ${runscopeApiKey}`
                    },
                    validateStatus: () => true,
                });
                
                if(testListResponse.status != 200) {
                    // Not Found, so testList end reached
                    if(testListResponse.status == 404) { 
                        console.log("Runscope API Test list end reached.");
                        noRemainingTestsToFetch = true;
                        continue;
                    }
                } else {
                    const partialTestList = testListResponse.data.data;
                    for(let test of partialTestList) {
                        let regexMatches = triggerUrlRegex.exec(test.trigger_url);
                        if(regexMatches == null) {
                            const errorString = `Error extracting trigger ID from URL: ${test.trigger_url}`;
                            console.log(errorString);
                            throw new Error(errorString);
                        }
                            
                        const testId = regexMatches[1];

                        // Ignore tests with [IGNORED] prefix in name
                        if(test.name.startsWith(`[IGNORED]`)) {
                            ignoredTestsCount ++;
                            console.log(`⚠ Test ignored, name: ${test.name}, testId; ${testId}`);
                            continue;
                        }

                        runnableTestsCount ++;
                        testList.push(testId);
                    }
                    if(partialTestList.length == 0)
                        noRemainingTestsToFetch = true;
                    else
                        nextOffsetToFetch += partialTestList.length;
                    await sleep(INTERVAL_BETWEEN_FETCH_TESTS_IDS_FROM_RUNSCOPE_IN_MS);
                    testListFetchedWithSuccess = true;
                }
            }
            catch(ex) {
                console.log(`An error ocurred when fetching Runscope API Test List, Attempts: ${runscopeAttempts}/3`);
            }
        }
        if(testListFetchedWithSuccess == false && noRemainingTestsToFetch == false) {
            console.log(`❌ ERROR: failed to fetch test list from Runscope API`);
            process.exit(1);
        }
    }

    console.log(`Test list fetched, total: ${runnableTestsCount + ignoredTestsCount}, runnable: ${runnableTestsCount}, ignored: ${ignoredTestsCount}`);
    return testList;    
}

function parseArguments() {
    const INITIAL_ARG_INDEX = 2;

    let args = process.argv;
    let runscopeKeyArgumentFound = false;
    let bucketArgumentFound = false;
    let environmentArgumentFound = false;

    for (let i = INITIAL_ARG_INDEX; i < args.length; i++) {
        if (args[i] === '-key') {
            ++i;
    
            if(i >= args.length) {
                throw Error('Missing Runscope API Key, use: -key RUNSCOPE_API_KEY');
            }
            runscopeApiKey = args[i].trim();
            runscopeKeyArgumentFound = true;
        } else if(args[i] === '-bucket') {
            ++i

            if(i>= args.lenth) {
                throw Error('Missing Bucket Key, use -bucket BUCKET_KEY');
            }
            bucketKey = args[i].trim();
            bucketArgumentFound = true;
        } else if(args[i] === '-env') {
            ++i;
    
            if(i >= args.length) {
                throw Error('Missing Environment ID, use -env ENVIRONMENT_ID');
            }
            environmentId = args[i].trim();
            environmentArgumentFound = true;
        } else if (args[i] === '-tests') {
            readingTestsFromArgs = true;
        } else if (readingTestsFromArgs) {
            fromArgsTestIds.push(args[i]);
        }
    }

    if(!(runscopeKeyArgumentFound && bucketArgumentFound && environmentArgumentFound)) {
        throw Error('Missing args, use: -key RUNSCOPE_API_KEY -bucket BUCKET_KEY -env ENVIRONMENT_ID');
    }
}

function validateArguments() {
    const runscopeIdsRegex = /^[0-9a-f]{8}\-[0-9a-f]{4}\-[0-9a-f]{4}\-[0-9a-f]{4}\-[0-9a-f]{12}$/;
    const bucketKeyRegex = /^[0-9a-z]{12}$/;

    if(!runscopeIdsRegex.test(runscopeApiKey))
        throw Error('Invalid Runscope API Key, use: -key YOUR_RUNSCOPE_API_KEY');

    if(!bucketKeyRegex.test(bucketKey))
        throw Error('Invalid Bucket Key, use: -bucket YOUR_BUCKET_KEY')
    
    if(!runscopeIdsRegex.test(environmentId))
        throw Error('Invalid Environment, use: -env YOUR_ENVIRONMENT_ID');

    for(let testId of fromArgsTestIds) {
        if(!runscopeIdsRegex.test(testId))
            throw Error('Invalid testId, use: -tests TEST_ID1 TEST_ID2 TEST_ID3 ...');
    }
}

async function fetchEnvironmentData() {
    return new Promise((resolve, reject) => {
        let initialTestVariables = undefined;
        axios.get(`https://api.runscope.com/buckets/${bucketKey}/environments/${environmentId}`, {
            headers: {
                'Authorization': `Bearer ${runscopeApiKey}`
            }
        }).then((response) => {
            environmentName = response.data.data.name;
            initialTestVariables = response.data.data['initial_variables'];
            resolve({environmentName, initialTestVariables});
        }).catch((reason) => {
            if(reason.response.status == 404)
                throw Error(`Invalid environment, Environment ID: ${environmentId}`);
            throw Error(`An unexpected error occurred when fetching data for Environment: ${environmentId}, statusCode: ${reason.response.status}`);
        });
    });
}

function printSharedEnvironmentVariables(initialEnvironmentVariables) {
    const validEnvironmentVariables = arrayMapToObject(initialEnvironmentVariables, value => {
        return value != '';
    });

    const environmentVariablesCount = Object.keys(validEnvironmentVariables).length;
    console.log(`\nFound ${environmentVariablesCount} Shared environment variables.`);

    let lineCounter = 0;

    const printColumns = columnify(validEnvironmentVariables, {
        columns: ['ENVIRONTMENT VARIABLE', 'VALUE'],
    }).split('\n').map(value => {
        lineCounter ++;
        if(lineCounter == 1)
            return `            ${value}\n`;
        return `            ${value}`;
    });

    console.log(printColumns.join('\n') + '\n');
}

async function runTestsInBatches(testsIds, maximumTestsPerBatch) {
    const runningTestIds = [];

    let batchList = splitArrayInPages(testsIds, maximumTestsPerBatch);
    console.log(`Tests will be triggered in ${batchList.length} batches with a maximum of ${maximumTestsPerBatch} tests per batch.`);

    for(let [batchIndex, batch] of batchList.entries()) {
        const batchStartTimestamp = Date.now();
        console.log(`Batch ${batchIndex + 1}/${batchList.length} with ${batch.length} tests.`);
        let pendingTestPromises = [];
        for(let testId of batch) {
            const testTriggerPromise = triggerTest(testId);
            testTriggerPromise.then((testTriggerResult) => {
                runningTestIds.push({testId, triggeredTestId: testTriggerResult.triggeredTestId, testRunId: testTriggerResult.testRunId});
                testNames[testId] = testTriggerResult.testName;
                console.log(`   └────── Test triggered, testName: ${testTriggerResult.testName}, testId: ${testId}`);
            });
            pendingTestPromises.push(testTriggerPromise);
        }

        await Promise.all(pendingTestPromises).catch(() => { /* Just ignore these errors */ });
        const batchDuration = Date.now() - batchStartTimestamp;
        const timeToWaitToExecuteNextBatch = MINIMUM_INTERVAL_BETWEEN_BATCH_EXECUTION_IN_MS - batchDuration;
        console.log(`   └────── Batch finished in ${Date.now() - batchStartTimestamp}ms`);
        
        if(batchIndex != batchList.length && timeToWaitToExecuteNextBatch > 0) {
            console.log(`   └────── Waiting ${timeToWaitToExecuteNextBatch}ms before execute next batch.\n`);
            await sleep(timeToWaitToExecuteNextBatch);
        }
        else
            console.log('\n');
    }
    return runningTestIds;
}

function triggerTest(testId) {
    return new Promise((resolve) => {
        axios.post(`https://api.runscope.com/radar/${testId}/trigger?runscope_environment=${environmentId}`)
            .then((value) => {
                const testRunId = value.data.data.runs[0].test_run_id;
                const triggeredTestId = value.data.data.runs[0].test_id;
                const testName = value.data.data.runs[0].test_name;
                resolve({triggeredTestId, testRunId, testName});
            }).catch(async reason => {
                if(reason.response.status == 404) {// Not found
                    throw Error(`Test not found,  testId: ${testId}`);
                }
                else if(reason.response.status == 429) { // Too many requests
                    let remainingRetries = 10;
                    let retriedWithSuccess = false;
                    while(retriedWithSuccess == false && remainingRetries > 0) {
                        console.log(`Too many requests to Runscope API, waiting ${MINIMUM_INTERVAL_BETWEEN_BATCH_EXECUTION_IN_MS}ms before retry.`);
                        await sleep(MINIMUM_INTERVAL_BETWEEN_BATCH_EXECUTION_IN_MS);
                        triggerTest(testId)
                            .then((retryReturnedData) => {
                                retriedWithSuccess = true;
                                remainingRetries = 0;
                                resolve(retryReturnedData);
                            });
                    }
                }
                else {
                    throw Error(`An unexpected error occurred when test is triggered, testId: ${testId}, statusCode: ${reason.response.status}`);
                }
            });
    });
}

function startVerificationOnTests(runningTestIds) {
    let intervalLocked = false;
    const intervalId = setInterval(async function() {
        if(intervalLocked == false) {
            intervalLocked = true;
            
            var notFinishedTests = runningTestIds.filter((value) => {
                return !finishedTestIds.includes(value);
            });

            if(notFinishedTests.length > 0)
                console.log(`\nWaiting to finish ${notFinishedTests.length} tests of ${runningTestIds.length}\n`);

            for(let notFinishedTest of notFinishedTests) {
                let testAlreadyVerified = false;
                for(let retries = 5; testAlreadyVerified == false && retries > 0; retries --) {
                    console.log(`Verifying test ${testNames[notFinishedTest.testId]}, result: https://www.runscope.com/radar/${bucketKey}/${notFinishedTest.triggeredTestId}/history/${notFinishedTest.testRunId}`);
                    await axios.get(`https://api.runscope.com/buckets/${bucketKey}/tests/${notFinishedTest.triggeredTestId}/results/${notFinishedTest.testRunId}`, {
                        headers: {
                            'Authorization': `Bearer ${runscopeApiKey}`
                        }
                    }).then(value => {
                        if(value.status == 200 && value.data.data.finished_at != null) {
                            finishedTestIds.push(notFinishedTest);
                            finishedTestResults[`${notFinishedTest.triggeredTestId}_${notFinishedTest.testRunId}`] = { testId: notFinishedTest.testId, runscopeData: value.data.data };
                        }
                    }).catch(async reason => {
                        console.log(`Error when reading test result for ${testNames[notFinishedTest.testId]} test, reason: ${JSON.stringify(reason)}`);
                        await sleep(INTERVAL_BETWEEN_TEST_VERIFICATION_RETRY);
                    });
                    testAlreadyVerified = true;
                }
            }
            if(notFinishedTests.length == 0) {
                clearInterval(intervalId);
                printTestsExecutionResults();
            }
            intervalLocked = false;
        }
    }, INTERVAL_BETWEEN_TEST_VERIFICATIONS_IN_MS);
}

function printTestsExecutionResults() {
    let failedTests = 0;
    console.log('\n');

    for(let testResult in finishedTestResults) {
        const testName = testNames[finishedTestResults[testResult].testId];

        const testResultData = finishedTestResults[testResult].runscopeData;
        const success = testResultData.assertions_failed == 0;
        const statusIcon = success ? '✅' : '❌';
        const statusMessage = success ? 'OK' : 'FAIL';
        console.log(`[${statusMessage}] ${statusIcon} - ${testName} - ${testResultData.assertions_passed}/${testResultData.assertions_defined} assertions passed`);
        if(success == false) {
            failedTests ++;
            console.log(`    └────── Runscope URL: https://www.runscope.com/radar/${testResultData.bucket_key}/${testResultData.test_id}/history/${testResultData.test_run_id}`);
        }
    }

    if(failedTests > 0) {
        console.log(`❌ ERROR: ${failedTests} tests failed, ${finishedTestIds.length - failedTests} tests passed`);
        process.exit(1);
    }
    console.log(`✅ SUCCESS: ${finishedTestIds.length} tests passed`);    
}

function splitArrayInPages(elements, pageSize = 8) {
    var result = [];
    while (elements.length) {
        result.push(elements.splice(0, pageSize));
    }
    return result;
}

function arrayMapToObject(object, filterFunction) {
    let results = {};
    return Object.keys(object).reduce(function(result, key) {
        if(filterFunction(key)) {
            results[key] = object[key];
            return results;
        }
    }, {});
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
