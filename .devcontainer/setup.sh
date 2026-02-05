#!/bin/bash

cd /app/frontend
npm install @angular/cli --force
npm install --force
npm run generate:all

cd /app/backend
openssl genrsa -out config/private.pem 2048
openssl rsa -in config/private.pem -out config/public.pem -outform PEM -pubout
yum install -y dos2unix
dos2unix ./bin/repl

pip3 install ecmwf-api-client eccodes numpy cdsapi 

export PYTHON="/usr/bin/python3"
julia +1.10 --project -e 'using Pkg; Pkg.instantiate()'
julia +1.10 --project /app/backend/setup.jl
