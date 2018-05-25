const async = require('async');
const request = require('request');

let args = process.argv;
let environment = '';
let testsIds = [];
let key = '';
let readingTests = false;

// Carrega os argumentos
for (let i = 2; i < args.length; i++) {
    if(args[i] === '-env') {
        ++i;

        if(i >= args.length) {
            throw Error("Environment inválido, utilize -env ENVIRONMENT");
        }

        environment = args[i];
    } else if (args[i] === '-key') {
        ++i;

        if(i >= args.length) {
            throw Error("Key inválida, utilize -key KEY");
        }

        key = args[i];
    } else if (args[i] === '-tests') {
        readingTests = true;
    } else if (readingTests) {
        testsIds.push(args[i]);
    }
}

// Verificação simples
if(key == '') {
    throw Error("Key inválida, utilize -key KEY");
}

if(environment == '') {
    console.log("Enviando os testes pelo ambiente padrão");
}

if(testsIds.length == 0) {
    throw Error("Testes inválidos, utilize -tests TEST_ID_1 TEST_ID_2 TEST_ID_3...");
}

// Array de funções para chamar o request iniciais dos testes
let requestFunctions = [];

// Itera pelos testes enviados por argumento criando novas funções de request
for (let i = 0; i < testsIds.length; i++) {
    // Coloca na array a função de request
    requestFunctions.push((callback) => {
        request({
            url: "https://api.runscope.com/radar/"+testsIds[i]+"/trigger?runscope_environment=" + environment,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": 'Bearer ' + key
            }
        }, async (error, response, body) => {
            if (!error && response.statusCode === 201) { // HTTP Status 201 - CREATED
                let result = await status(body);
                callback(null, result);
            } else {
                callback(error, null);
            }
        });
    });
}

// Verifica o teste recursivamente (por timeout)
function verifyTest(test_url) {
    console.log('Verificando ' + test_url);

    request({
        url: test_url,
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": 'Bearer ' + key
        }
    }, function (error, res, body) {
        if (!error && res.statusCode == 200) {
            let result = JSON.parse(body);

            let running = (result.data.finished_at == null);
            if (running) {
                setTimeout(function() {
                    verifyTest(test_url);
                }, 5000);
            } else {
                console.log('Result ' + body);

                let assertions_failed = result.data.assertions_failed;
                if(assertions_failed > 0) {
                    // Dá o erro para parar a execução
                    throw Error("ASSERTION FAILED");
                } else {
                    console.log("SUCESSO!");
                }
            }
        } else {
            throw Error(body);
        }
    });
}

// Executa os requests iniciais paralelamente
async.parallel(requestFunctions, (err, results) => {
    console.log(results);

    for (let i = 0; i < results.length; i++) {
        let result = JSON.parse(results[i]);

        let bucketKey = result.data.runs[0].bucket_key;
        let test_id = result.data.runs[0].test_id;
        let test_run_id = result.data.runs[0].test_run_id;

        let runsFail = result.data.runs_failed;
        if (runsFail > 0) {
            throw Error("Falha ao enviar teste id " + test_run_id);
        }

        let test_url = 'https://api.runscope.com/buckets/' + bucketKey + '/tests/' + test_id + '/results/' + test_run_id;
        console.log('Test Result URL: ' + test_url);

        setTimeout(function () {
            verifyTest(test_url);
        }, 10000);
    }
});

const status = (body) => {
    return new Promise((resolve, reject) => {
        resolve(body);
    });
};