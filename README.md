README para Runscope Paralelo
========================

Introdução
------------

O Runscope Paralelo consiste em uma biblioteca simples para execução de testes paralelos no Runscope, 
inicialmente desenvolvida para integração com o Jenkins.

Requisito
------------
* Node 8+
* Key da Conta do Runscope

Instalação
------------
Clone o projeto em qualquer pasta que desejar.
Vá até a pasta e instale os módulos do node através do:

`npm install`

Utilização
------------

Apenas execute o comando, sendo o parâmetro -env opcional, caso não seja enviado ele executa no 
ambiente default do teste.

`node index.js -key RUNSCOPE_API_KEY -env ENV_DESEJADO -tests TEST_RUN_ID_1 TEST_RUN_ID_2 TEST_RUN_ID_3`

Integração com o Jenkins
------------

Para integrar com o Jenkins vá até seu Job, no Build adicione um passo de Execute Shell, e no 
campo preencha com os dados da Utilização, não esqueça de colocar o caminho completo 
para o arquivo index.js.