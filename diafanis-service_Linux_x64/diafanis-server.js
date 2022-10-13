//Developed and tested with Node.js version 18.7.0

'use strict';

const compression = require('compression');
const express = require('express');
const app = express();
app.use(compression());
const ffi = require('ffi-napi');
const ref = require('ref-napi');

const child_process = require("child_process");

const ArrayType = require('ref-array-napi');

const gc=require('js-gc');
//const sizeof = require('sizeof'); 

//const platform = process.platform;
//const architecture = process.arch;
var numberOfActiveComputations = 0;
var numberOfRequestslastGC = 0;
var numberOfGCs = 0;
var saveHeap = false;

var diafanisComputations_arr = [];
//[0] the address of 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
//[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
//[2] milliseconds timeout to delete (0 means no timeout)
//[3] number of variables
//[4] interval 0:false 1:true
//[5] valid/not deleted 0:false 1:true

const deleteTimeout = 3600000; 

const bodyParser = require('body-parser'); 
app.use(bodyParser.json({limit: '5mb'}));
app.use(bodyParser.urlencoded({limit: '5mb', extended: true}));

var versionNumber = 0;

var debugEnabled = true;//false;


function coprocessorSimulationLibraryName()
{
    let coprocessorSimulationLibrary_str = null;
    let platform = process.platform;
    let architecture = process.arch;

    if ((platform === 'linux') && (architecture === 'x64'))
    {
        coprocessorSimulationLibrary_str = './coproc_simu_libpaceval_linux_sharedLIB.so';
    }
    else if ((platform === 'linux') && (architecture === 'arm64'))
    {
        coprocessorSimulationLibrary_str = './coproc_simu_libpacevalARM64_sharedLIB.so';
    }
    else
    {
        throw new Error('unsupported platform and architecture for coprocessor simulation : '
                        + platform + ' ' + architecture + '-please, contact us via info@diafanis.com')
    }
    
    return coprocessorSimulationLibrary_str;
}


var intPtr_ffi = ref.refType('int');
var doubleArray_ffi = ArrayType('double');
var pointerArray_ffi = ArrayType('pointer');
var doublePtr_ffi = ref.refType('double');
var double_ffi = ref.types.double;
var longPtr_ffi = ref.refType('long');

var mathEngineLibrary_ffi = ffi.Library(coprocessorSimulationLibraryName(),
{
    'pacevalLibrary_Initialize': [ 'bool', [ 'string' ] ],
    'pacevalLibrary_CreateComputation': [ 'pointer', [ 'string', 'uint32', 'string', 'int', 'pointer' ] ],
    'pacevalLibrary_GetIsError': [ 'bool', [ 'pointer' ] ],
    'pacevalLibrary_dmathv': [ 'double', [ 'pointer', intPtr_ffi , 'string', 'uint32', 'string', doubleArray_ffi ] ],   
    'pacevalLibrary_GetErrorInformation': [ 'int', [ 'pointer', 'char*', longPtr_ffi ] ],   
    'pacevalLibrary_CreateErrorInformationText': [ 'int', [ 'pointer', 'char*', 'char*' ] ],
    'pacevalLibrary_dGetComputationResult': [ 'double', [ 'pointer', doubleArray_ffi , doublePtr_ffi , doublePtr_ffi ] ],
    'pacevalLibrary_dGetComputationResultExt': [ 'bool', [ 'pointer', doubleArray_ffi , 'uint32', doublePtr_ffi , doublePtr_ffi , doublePtr_ffi, intPtr_ffi ] ],
    'pacevalLibrary_dGetMultipleComputationsResults': [ 'bool', [ pointerArray_ffi, 'uint32', doubleArray_ffi , doublePtr_ffi , doublePtr_ffi , doublePtr_ffi, intPtr_ffi ] ],
    'pacevalLibrary_dConvertFloatToString': [ 'int', [ 'pointer', double_ffi ] ],
    'pacevalLibrary_GetComputationInformationXML': [ 'uint32', [ 'pointer', 'char*' ] ],
    'pacevalLibrary_GetComputationVersionString': [ 'int', [ 'pointer', 'char*' ] ],
    'pacevalLibrary_DeleteComputation': [ 'bool', [ 'pointer' ] ],
}); 

function sleepTime(ms) 
{
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runGarbageCollection()
{
    if (debugEnabled == true)
        console.log(`start garbage collection - timestamp: ${new Date().toISOString()}`);
    
    await sleepTime(1000)
    child_process.execSync("sleep 1");
    await global.gc();
    
    if (debugEnabled == true)
    {
        console.log(`finished garbage collection - timestamp: ${new Date().toISOString()}`);
        console.log(``);
    }
}

function logMemoryUsed()
{
    let kbHeap = process.memoryUsage().heapUsed / 1024;
    let kbRoundedHeap = Math.round(kbHeap * 100) / 100;
    let kbExternal = process.memoryUsage().external / 1024;
    let kbRoundedExternal = Math.round(kbExternal * 100) / 100;
    
//  var errorType = ref.alloc('int');
    if (debugEnabled == true)
    {
        console.log(``);
        console.log(`- Status diafanis server ---------------------`);
        console.log(`Resident Set Size: ${ process.memoryUsage().rss / 1024 }K`);
        console.log(`Total Heap Size: ${ process.memoryUsage().heapTotal / 1024 }K`);
        console.log(`Heap allocated: ${kbRoundedHeap}K`);
        console.log(`External: ${kbRoundedExternal}K`);
    
//      console.log(`Array Computations: ${sizeof.sizeof(diafanisComputations_arr, true)}`);   
        console.log(`Active Computations: ${numberOfActiveComputations}`);
        console.log(`Number Of Requests since last GC: ${numberOfRequestslastGC}`);
        console.log(`Number Of GCs: ${numberOfGCs}`);
        console.log(`----------------------------------------------`);
    }

    if (numberOfRequestslastGC >= 250) //after 250 computations we will run a garbage collection
    {       
        numberOfRequestslastGC = 0;
        numberOfGCs++;
        
        if (global.gc) 
        {
            runGarbageCollection();
        } 
        else 
        {
            if (debugEnabled == true)
                console.warn('No GC hook for memory cleanup! Start your program as `node --expose-gc ./diafanis-server.js --max-old-space-size=6000`.');
        }
    }
}

function findEmptyComputationPos()
{
    let numberOfComputations = diafanisComputations_arr.length;
    let iCount = 0;

    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        //diafanisComputations_arr[iCount][5] valid/not deleted 0:false 1:true
        if (diafanisComputations_arr[iCount][5] == 0)
        {
            return iCount;
        }
    }

    return -1;
}

function findComputationPos(handle_diafanisComputation_str)
{
    let numberOfComputations = diafanisComputations_arr.length;
    let iCount = 0;

    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        //diafanisComputations_arr[iCount][5] valid/not deleted 0:false 1:true
        //diafanisComputations_arr[iCount][1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
        if ((diafanisComputations_arr[iCount][5] == 1) && (diafanisComputations_arr[iCount][1].address() == handle_diafanisComputation_str))
        {
            return iCount;
        }
    }

    if (debugEnabled == true)
        console.log(`not found computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
    
    return -1;
}

function deleteComputationTimer()
{
    let numberOfComputations = diafanisComputations_arr.length;
    let iCount = 0;
    let success = false;

    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        //diafanisComputations_arr[iCount][5] valid/not deleted 0:false 1:true
        //diafanisComputations_arr[iCount][2] milliseconds timeout to delete
        if ((diafanisComputations_arr[iCount][5] == 1) && (Date.now().valueOf() > diafanisComputations_arr[iCount][2]))
        {
            //diafanisComputations_arr[iCount][1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
            success = mathEngineLibrary_ffi.pacevalLibrary_DeleteComputation(diafanisComputations_arr[iCount][1]);
            
            if (success == true)
            {
                if (debugEnabled == true)
                {
                    console.log(`handle delete computation - timestamp: ${new Date().toISOString()}`);
                    //diafanisComputations_arr[iCount][0] the address of 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
                    console.log(`deleted computation handle_diafanisComputation: ${diafanisComputations_arr[iCount][1].address()}`);
                }
                
                diafanisComputations_arr[iCount][5] = 0; //[5] valid/not deleted 0:false 1:true
                numberOfActiveComputations--;
                
                if (debugEnabled == true)
                {
                    console.log(`number of active computations: ${numberOfActiveComputations}`);
                    console.log(``);
                }
            }
        }
    }
    
    setTimeout(deleteComputationTimer, deleteTimeout); 
}

function handleCreateComputation(req, res, senddata_in)
{
    let handle_diafanisComputation = null;
    let isError = false;
    let numberOfVariables = 0;
    let function10chars = '';
    let functionLength = 0;
    let interval = false;
    let function_str = '';
    let variables_str = '';

    if (req.query.functionString != null) //GET  
    {
        function_str = req.query.functionString;
        numberOfVariables = parseInt(req.query.numberOfVariables);
        variables_str = req.query.variables.replace(/;/g, ' ');
        let interval_str = req.query.interval;

        if ((interval_str == 'yes') || (interval_str == 'true'))
            interval = true;
    }
    else //POST  
    {
        function_str = req.body.functionString;
        numberOfVariables = parseInt(req.body.numberOfVariables);
        variables_str = req.body.variables.replace(/;/g, ' ');
        let interval_str = req.body.interval;

        if ((interval_str == 'yes') || (interval_str == 'true'))
            interval = true;
    }

    let now = require('performance-now');
    let success = false;

    if (debugEnabled == true)
        console.log(`handle create computation - timestamp: ${new Date().toISOString()}`);

    if (numberOfActiveComputations == 0)
    {
        success = mathEngineLibrary_ffi.pacevalLibrary_Initialize(null);
        
        if (debugEnabled == true)
            console.log(`diafanis initialize library: ${success}`);
    }

    let timeCreate = now(); 
    handle_diafanisComputation = mathEngineLibrary_ffi.pacevalLibrary_CreateComputation(function_str,
                                        numberOfVariables, variables_str, interval, null);
    timeCreate = (now() - timeCreate) / 1000;
    
    numberOfActiveComputations++;
    isError = mathEngineLibrary_ffi.pacevalLibrary_GetIsError(handle_diafanisComputation);
       
    if (debugEnabled == true)      
        console.log(`created new computation handle_diafanisComputation: ${handle_diafanisComputation.address()}`);

    let handle_diafanisComputation_addr = handle_diafanisComputation.address();

    functionLength = function_str.length;
    function10chars = function_str.substring(0, 10);
    if (functionLength > 10)
    {
        function10chars = function10chars + '(...)';
    }

    let maxLengthStr = mathEngineLibrary_ffi.pacevalLibrary_CreateErrorInformationText(handle_diafanisComputation, null, null);
    let errorMessage_str = Buffer.alloc(maxLengthStr, 0, 'ascii');
    let errorDetails_str = Buffer.alloc(maxLengthStr, 0, 'ascii');
    maxLengthStr = mathEngineLibrary_ffi.pacevalLibrary_CreateErrorInformationText(handle_diafanisComputation,
                   errorMessage_str, errorDetails_str);

    let errorType = ref.alloc('int');
    if (versionNumber == 0)
        versionNumber = mathEngineLibrary_ffi.pacevalLibrary_dmathv(null, errorType, 'paceval_VersionNumber', 0, '', null);
    
    let errorPosition = ref.alloc('long');
    let errorPositionLong = -1;
    
    errorType = mathEngineLibrary_ffi.pacevalLibrary_GetErrorInformation(handle_diafanisComputation, null, errorPosition);
    
    if (errorPosition.deref() == -1)
        errorPositionLong = '';
    else
        errorPositionLong = errorPosition.deref();

    let return_arr =
    {
        'handle_diafanisComputation': handle_diafanisComputation_addr,
        'function-10chars': function10chars,
        'function-length': functionLength,
        'error-type-number': errorType,
        'error-position': errorPositionLong,
        'error-type': errorDetails_str.toString().replace(/\0/g, ''),
        'error-message': errorMessage_str.toString().replace(/\0/g, ''),
        'time-create': timeCreate.toFixed(6) + 's',
        'version-number': versionNumber
    };

    if (senddata_in == true)
    { 
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(return_arr));
    }

    if (debugEnabled == true)
        console.log(`time to create: ${timeCreate.toFixed(6) + 's'}`);
                                   
    let position = -1;  
    position = findEmptyComputationPos();
    
    if (position >= 0)
    {
        if (debugEnabled == true)
            console.log(`reused Array Computations position: ${position}`);
    }
    else
    {
        position = diafanisComputations_arr.push([  ]) -1;
        
        if (debugEnabled == true)
            console.log(`created new Array Computations position: ${position}`);
    }
    
    diafanisComputations_arr[position][0] = handle_diafanisComputation.address(); //[0] the address of 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
    diafanisComputations_arr[position][1] = handle_diafanisComputation; //[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
    diafanisComputations_arr[position][2] = Date.now().valueOf() + deleteTimeout; //[2] milliseconds timeout to delete (0 means no timeout)
    if (req.query.numberOfVariables != null) //GET    
        diafanisComputations_arr[position][3] = parseInt(req.query.numberOfVariables); //[3] number of variables (GET)
    else //POST
        diafanisComputations_arr[position][3] = parseInt(req.body.numberOfVariables); //[3] number of variables (POST)
    if (interval == false)
        diafanisComputations_arr[position][4] = 0; //[4] interval: false
    else
        diafanisComputations_arr[position][4] = 1; //[4] interval: true
    diafanisComputations_arr[position][5] = 1; //[5] valid/not deleted: true

    if (debugEnabled == true)
    {
        console.log(`1 hour deletion timer created for computation handle_diafanisComputation: ${handle_diafanisComputation.address()}`);
        console.log(`number of active computations: ${numberOfActiveComputations}`);
        console.log(`array size: ${diafanisComputations_arr.length}`);
    }
    
    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);

    return handle_diafanisComputation_addr;
}

function handleGetComputationResult(req, res, handle_diafanisComputation_str_in)
{
    let handle_diafanisComputation_str = handle_diafanisComputation_str_in;

    let existingComputation = false;
    let isError = false;
    let numberOfVariables = 0;
    let interval = false;
    let values_ar = [];

    if (req.query.handle_diafanisComputation != null) //GET  
    {
        if (handle_diafanisComputation_str == null)
            handle_diafanisComputation_str = req.query.handle_diafanisComputation;
    }
    else //POST
    {
        if (handle_diafanisComputation_str == null)
            handle_diafanisComputation_str = req.body.handle_diafanisComputation;
    }

    if (handle_diafanisComputation_str == null)
    {
        handle_diafanisComputation_str = handle_diafanisComputation_str_in;
    }

    let handle_diafanisComputation = null;
    let position = -1;

    if (handle_diafanisComputation_str != null)
    {
        position = findComputationPos(handle_diafanisComputation_str);
        if (position >= 0)
        {
            if (debugEnabled == true)
                console.log(`reuse computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
        
            handle_diafanisComputation = diafanisComputations_arr[position][1]; //[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
            diafanisComputations_arr[position][2] = 0; //[2] milliseconds timeout to delete (0 means no timeout)
            numberOfVariables = diafanisComputations_arr[position][3]; //[3] number of variables
            
            if (diafanisComputations_arr[position][4] == 0) //[4] interval 0:false 1:true
                interval = false;
            else
                interval = true;
            
            existingComputation = true;
        }
        else
        {
            res.status(500).json({ error: 'handle_diafanisComputation does not exist' });

            return;
        }
    }
    else
    {
        res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
        return;
    }

    if (req.query.values != null) //GET    
        values_ar = JSON.parse('[' + req.query.values.replace(/;/g, ',') + ']');
    else //POST
        values_ar = JSON.parse('[' + req.body.values.replace(/;/g, ',') + ']');

    let now = require('performance-now');

    if (debugEnabled == true)
        console.log(`handle get result for computation handle_diafanisComputation: ${handle_diafanisComputation_str} - timestamp: ${new Date().toISOString()}`);

    let valuesVariablesArray = new doubleArray_ffi(numberOfVariables);
    let iCount = 0;

    for (iCount = 0; iCount < numberOfVariables; iCount++)
    {
        valuesVariablesArray[iCount] = values_ar[iCount];
    }

    let trustedMinResult = ref.alloc('double');
    let trustedMaxResult = ref.alloc('double');
    let timeCreate = 0;
    let result_str = Buffer.alloc(25, 0, 'ascii');
    let trustedMinResult_str = Buffer.alloc(25, 0, 'ascii');
    let trustedMaxResult_str = Buffer.alloc(25, 0, 'ascii');

    let handle_diafanisComputation_addr = handle_diafanisComputation.address();
    let result = 0;

    let timeCalculate = now(true);
    if (interval == false)
    {
        result = mathEngineLibrary_ffi.pacevalLibrary_dGetComputationResult(handle_diafanisComputation,
            valuesVariablesArray, null, null);
    }
    else
    {
        result = mathEngineLibrary_ffi.pacevalLibrary_dGetComputationResult(handle_diafanisComputation,
            valuesVariablesArray, trustedMinResult, trustedMaxResult);
    }
    timeCalculate = (now() - timeCalculate) / 1000;
      
    isError = mathEngineLibrary_ffi.pacevalLibrary_GetIsError(handle_diafanisComputation);
    let success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(result_str, result);

    if (interval == true)
    {
        success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(trustedMinResult_str, trustedMinResult.deref());
        success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(trustedMaxResult_str, trustedMaxResult.deref());
    }

    let maxLengthStr = mathEngineLibrary_ffi.pacevalLibrary_CreateErrorInformationText(handle_diafanisComputation, null, null);
    let errorMessage_str = Buffer.alloc(maxLengthStr, 0, 'ascii');
    let errorDetails_str = Buffer.alloc(maxLengthStr, 0, 'ascii');
    maxLengthStr = mathEngineLibrary_ffi.pacevalLibrary_CreateErrorInformationText(handle_diafanisComputation,
                   errorMessage_str, errorDetails_str);

    let errorType = ref.alloc('int');
    if (versionNumber == 0)
        versionNumber = mathEngineLibrary_ffi.pacevalLibrary_dmathv(null, errorType, 'paceval_VersionNumber', 0, '', null);
    
    let errorPosition = ref.alloc('long');
    let errorPositionLong = -1;
    
    errorType = mathEngineLibrary_ffi.pacevalLibrary_GetErrorInformation(handle_diafanisComputation, null, errorPosition);
    
    if (errorPosition.deref() == -1)
        errorPositionLong = '';
    else
        errorPositionLong = errorPosition.deref();
    
    if (errorType != 0)
    {
        result_str = "";
        if (interval == true)
        {
            trustedMinResult_str = "";
            trustedMaxResult_str = "";
        }
    }

    let return_arr =
    {
        'handle_diafanisComputation': handle_diafanisComputation_addr,
        'result': result_str.toString().replace(/\0/g, ''),
        'interval-min-result': trustedMinResult_str.toString().replace(/\0/g, ''),
        'interval-max-result': trustedMaxResult_str.toString().replace(/\0/g, ''),
        'error-type-number': errorType,
        'error-position': errorPositionLong,
        'error-type': errorDetails_str.toString().replace(/\0/g, ''),
        'error-message': errorMessage_str.toString().replace(/\0/g, ''),
        'time-calculate': timeCalculate.toFixed(6) + 's',
        'version-number': versionNumber
    };

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(return_arr));

    if (debugEnabled == true)
        console.log(`time to calculate: ${timeCalculate.toFixed(6) + 's'}`);

    diafanisComputations_arr[position][2] = Date.now().valueOf() + deleteTimeout; //[2] milliseconds timeout to delete (0 means no timeout)
   
    if (debugEnabled == true)
    {
        console.log(`deletion timer prolonged by 1 hour for computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
        console.log(`number of active computations: ${numberOfActiveComputations}`);
    }
    
    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);
}

function handleGetComputationResultExt(req, res)
{
    let numberOfCalculations = 0; 
    let handle_diafanisComputation_str = '';
    let existingComputation = false;
    let hasError = false;
    let numberOfVariables = 0;
    let interval = false;
    let values_str = '';
    let values_ar = [];

    if (req.query.numberOfCalculations != null) //GET   
    {
        numberOfCalculations = parseInt(req.query.numberOfCalculations);
        handle_diafanisComputation_str = req.query.handle_diafanisComputation;
    }
    else //POST   
    { 
        numberOfCalculations = parseInt(req.body.numberOfCalculations); 
        handle_diafanisComputation_str = req.body.handle_diafanisComputation;
    }

    if (debugEnabled == true)
        console.log(`handle get results for multiple values for variables handle_diafanisComputations: ${handle_diafanisComputation_str} - timestamp: ${new Date().toISOString()}`);

    let handle_diafanisComputation = null;
    let position = -1;

    if (handle_diafanisComputation_str != null)
    {
        position = findComputationPos(handle_diafanisComputation_str);
        if (position >= 0)
        {
            if (debugEnabled == true)
                console.log(`reuse computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
                
            handle_diafanisComputation = diafanisComputations_arr[position][1]; //[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
            diafanisComputations_arr[position][2] = 0; //[2] milliseconds timeout to delete (0 means no timeout)
            numberOfVariables = diafanisComputations_arr[position][3]; //[3] number of variables
            
            if (diafanisComputations_arr[position][4] == 0) //[4] interval 0:false 1:true
                interval = false;
            else
                interval = true;
            
            existingComputation = true;
        }
        else
        {
            res.status(500).json({ error: 'handle_diafanisComputation does not exist' });

            return;
        }
    }
    else
    {
        res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
        return;
    }

    if (req.query.values != null) //GET    
        values_str = req.query.values;
    else //POST  
        values_str = req.body.values;

    values_str = values_str.replace(/;/g, ',');
    values_ar = values_str.split(',');

    let now = require('performance-now');
    let iCount = 0;

    let valuesVariablesArray = new doubleArray_ffi(numberOfCalculations * numberOfVariables);
    for (iCount = 0; iCount < numberOfCalculations * numberOfVariables; iCount++)
    {
        valuesVariablesArray[iCount] = values_ar[iCount];
    }

    let handle_diafanisComputation_addr = handle_diafanisComputation.address();

    let resultsArray = Buffer.allocUnsafe(numberOfCalculations * 8 /*double 8 bytes*/); 
    let trustedMinResultsArray = Buffer.allocUnsafe(numberOfCalculations * 8 /*double 8 bytes*/);
    let trustedMaxResultsArray = Buffer.allocUnsafe(numberOfCalculations * 8 /*double 8 bytes*/);
    let errorTypesArray = Buffer.allocUnsafe(numberOfCalculations * 4 /*int 4 bytes*/);

    let timeCalculate = now(true);
    
    if (interval == false)
    {
        hasError = mathEngineLibrary_ffi.pacevalLibrary_dGetComputationResultExt(handle_diafanisComputation, 
                     valuesVariablesArray, numberOfCalculations, resultsArray, null, null, errorTypesArray);
    }       
    else
    {
        hasError = mathEngineLibrary_ffi.pacevalLibrary_dGetComputationResultExt(handle_diafanisComputation, 
                     valuesVariablesArray, numberOfCalculations, resultsArray, trustedMinResultsArray, trustedMaxResultsArray, errorTypesArray);
    }
    timeCalculate = (now() - timeCalculate) / 1000;

    let errorType = ref.alloc('int');
    if (versionNumber == 0)
        versionNumber = mathEngineLibrary_ffi.pacevalLibrary_dmathv(null, errorType, 'paceval_VersionNumber', 0, '', null);

    let resultsArray_ar = new Array(numberOfCalculations);
    let trustedMinResultsArray_ar = new Array(numberOfCalculations);
    let trustedMaxResultsArray_ar = new Array(numberOfCalculations);
    let errorTypesArray_ar = new Array(numberOfCalculations);
    let result_str = Buffer.alloc(25, 0, 'ascii');
    let trustedMinResult_str = Buffer.alloc(25, 0, 'ascii');
    let trustedMaxResult_str = Buffer.alloc(25, 0, 'ascii');
    let errorTypesArray_str = Buffer.alloc(25, 0, 'ascii');
    let success = false;
    let stringToAdd;
    let errorTypeInt;

    for (iCount = 0; iCount < numberOfCalculations; iCount++)
    {       
        errorTypeInt = errorTypesArray.readInt32LE(iCount * 4 /*int 4 bytes*/);
        errorTypesArray_ar[iCount] = errorTypeInt;

        if (errorTypeInt == 0) //no error
        {
            success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(result_str, resultsArray.readDoubleLE(iCount * 8 /*double 8 bytes*/)); 
            stringToAdd = result_str.toString().replace(/\0/g, ''); 
            resultsArray_ar[iCount] = stringToAdd;
            result_str.fill(0);

            if (interval == true)
            {
                success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(trustedMinResult_str, trustedMinResultsArray.readDoubleLE(iCount * 8 /*double 8 bytes*/));   
                stringToAdd = trustedMinResult_str.toString().replace(/\0/g, ''); 
                trustedMinResultsArray_ar[iCount] = stringToAdd;
                trustedMinResult_str.fill(0);

                success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(trustedMaxResult_str, trustedMaxResultsArray.readDoubleLE(iCount * 8 /*double 8 bytes*/));   
                stringToAdd = trustedMaxResult_str.toString().replace(/\0/g, ''); 
                trustedMaxResultsArray_ar[iCount] = stringToAdd;
                trustedMaxResult_str.fill(0);
            }
        }
        else
        {
            resultsArray_ar[iCount] = '';
            if (interval == true)
            {
                trustedMinResultsArray_ar[iCount] = '';
                trustedMaxResultsArray_ar[iCount] = '';
            }
        }
    }

    let return_arr = 
    { 
        'number-of-multiple-values': numberOfCalculations, 
        'handle_diafanisComputation': handle_diafanisComputation_addr,
        'hasError': hasError,
        'results': resultsArray_ar,
        'interval-min-results': trustedMinResultsArray_ar,
        'interval-max-results': trustedMaxResultsArray_ar,
        'error-type-numbers': errorTypesArray_ar,
        'time-calculate': timeCalculate.toFixed(6) + 's',
        'version-number': versionNumber
    };

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(return_arr));

    if (debugEnabled == true)
        console.log(`time to calculate: ${timeCalculate.toFixed(6) + 's'}`);

    diafanisComputations_arr[position][2] = Date.now().valueOf() + deleteTimeout; //[2] milliseconds timeout to delete (0 means no timeout)
   
    if (debugEnabled == true)
    {
        console.log(`deletion timer prolonged by 1 hour for computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
        console.log(`number of active computations: ${numberOfActiveComputations}`);
    }

    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);
}

function handleGetMultipleComputationsResults(req, res)
{
    let existingComputation = false;
    let hasError = false;
    let isError = false;
    let numberOfComputations = 0; 
    let numberOfVariables = 0;
    let interval = -1;
    let handle_diafanisComputation_str_ar = [];
    let values_ar = [];
    let position = 0;
    let iCount = 0;
    let jCount = 0;

    if (req.query.numberOfdiafanisComputations != null) //GET 
    {
        numberOfComputations = parseInt(req.query.numberOfdiafanisComputations);
        handle_diafanisComputation_str_ar = JSON.parse('[' + req.query.handle_diafanisComputations.replace(/;/g, ',') + ']');
    }
    else //POST  
    { 
        numberOfComputations = parseInt(req.body.numberOfdiafanisComputations); 
        handle_diafanisComputation_str_ar = JSON.parse('[' + req.body.handle_diafanisComputations.replace(/;/g, ',') + ']');
    }

    if (debugEnabled == true)
        console.log(`handle get results for multiple computations handle_diafanisComputations: ${handle_diafanisComputation_str_ar} - timestamp: ${new Date().toISOString()}`);

    let handle_diafanisComputations_ar = [];

    if (numberOfComputations > 0)
    {
        for (iCount = 0; iCount < numberOfComputations; iCount++)
        {
            position = findComputationPos(handle_diafanisComputation_str_ar[iCount]);
            if (position >= 0)
            {
                if (debugEnabled == true)
                    console.log(`reuse computation handle_diafanisComputation: ${handle_diafanisComputation_str_ar[iCount]}`);

                handle_diafanisComputations_ar.push(diafanisComputations_arr[position][1]); //[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
                diafanisComputations_arr[position][2] = 0; //[2] milliseconds timeout to delete (0 means no timeout)
                numberOfVariables = diafanisComputations_arr[position][3]; //[3] number of variables
                
                if (interval != -1)
                {               
                    if ((interval == false) && (diafanisComputations_arr[position][4] != 0)) //[4] interval 0:false 1:true
                    {
                        res.status(500).json({ error: 'mixing non-interval computations with interval computations' });
                        return;
                    }
                    else if ((interval == true) && (diafanisComputations_arr[position][4] != 1)) //[4] interval 0:false 1:true
                    {
                        res.status(500).json({ error: 'mixing non-interval computations with interval computations' });
                        return;
                    }
                }
                if (diafanisComputations_arr[position][4] == 0) //[4] interval 0:false 1:true
                    interval = false;
                else
                    interval = true;

                existingComputation = true;
            }
            else
            {
                res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
                return;
            }            
        }
    }
    else 
    {
        res.status(500).json({ error: 'number of computations not valid' });
        return;
    }
    
    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        for (jCount = iCount + 1; jCount < numberOfComputations; jCount++)
        {
            if (handle_diafanisComputations_ar[iCount] == handle_diafanisComputations_ar[jCount])
            {
                res.status(500).json({ error: 'duplicate handle_diafanisComputation' });
                return;
            }
        }
    }

    if (req.query.values != null) //GET  
        values_ar = JSON.parse('[' + req.query.values.replace(/;/g, ',') + ']');
    else //POST   
        values_ar = JSON.parse('[' + req.body.values.replace(/;/g, ',') + ']');

    let now = require('performance-now');

    let int = ref.types.int;
    let intArray = ArrayType('int');

    let handle_diafanisComputationsArray = new pointerArray_ffi(numberOfComputations);
    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        handle_diafanisComputationsArray[iCount] = handle_diafanisComputations_ar[iCount];
    }

    let valuesVariablesArray = new doubleArray_ffi(numberOfVariables);
    for (iCount = 0; iCount < numberOfVariables; iCount++)
    {
        valuesVariablesArray[iCount] = values_ar[iCount];
    }

    let errorTypesArray_ar = [];
    let resultsArray = Buffer.allocUnsafe(numberOfComputations * 8 /*double 8 bytes*/); 
    resultsArray.fill(0);
    let trustedMinResultsArray = Buffer.allocUnsafe(numberOfComputations * 8 /*double 8 bytes*/);
    trustedMinResultsArray.fill(0);
    let trustedMaxResultsArray = Buffer.allocUnsafe(numberOfComputations * 8 /*double 8 bytes*/);
    trustedMaxResultsArray.fill(0);
    let errorTypesArray = Buffer.allocUnsafe(numberOfComputations * 4 /*int 4 bytes*/);
    errorTypesArray.fill(0);

    let errorType = ref.alloc('int');
    let success = false;
    
    let timeCalculate = now(true);
    if (interval == false)
    {
        hasError = mathEngineLibrary_ffi.pacevalLibrary_dGetMultipleComputationsResults(handle_diafanisComputationsArray, numberOfComputations,
            valuesVariablesArray, resultsArray, null, null, errorTypesArray);
    }
    else
    {
        hasError = mathEngineLibrary_ffi.pacevalLibrary_dGetMultipleComputationsResults(handle_diafanisComputationsArray, numberOfComputations,
            valuesVariablesArray, resultsArray, trustedMinResultsArray, trustedMaxResultsArray, errorTypesArray);
    }
    timeCalculate = (now() - timeCalculate) / 1000;

    if (versionNumber == 0)
        versionNumber = mathEngineLibrary_ffi.pacevalLibrary_dmathv(null, errorType, 'paceval_VersionNumber', 0, '', null);

    let resultsArray_ar = [];
    let trustedMinResultsArray_ar = [];
    let trustedMaxResultsArray_ar = [];
    let errorMessage_str_ar = [];
    let errorDetails_str_ar = [];
    let result_str = Buffer.alloc(25, 0, 'ascii');
    let trustedMinResult_str = Buffer.alloc(25, 0, 'ascii');
    let trustedMaxResult_str = Buffer.alloc(25, 0, 'ascii');
    let stringToAdd;
    let errorTypeInt;

    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        errorTypeInt = errorTypesArray.readInt32LE(iCount * 4 /*int 4 bytes*/);
        errorTypesArray_ar.push( errorTypeInt );
        
        if (errorTypeInt == 0) //no error
        {
            success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(result_str, resultsArray.readDoubleLE(iCount * 8 /*double 8 bytes*/));   
            stringToAdd = result_str.toString().replace(/\0/g, ''); 
            resultsArray_ar.push( stringToAdd );
            result_str.fill(0);

            if (interval == true)
            {
                success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(trustedMinResult_str, trustedMinResultsArray.readDoubleLE(iCount * 8 /*double 8 bytes*/));   
                stringToAdd = trustedMinResult_str.toString().replace(/\0/g, ''); 
                trustedMinResultsArray_ar.push( stringToAdd );
                trustedMinResult_str.fill(0);

                success = mathEngineLibrary_ffi.pacevalLibrary_dConvertFloatToString(trustedMaxResult_str, trustedMaxResultsArray.readDoubleLE(iCount * 8 /*double 8 bytes*/));   
                stringToAdd = trustedMaxResult_str.toString().replace(/\0/g, ''); 
                trustedMaxResultsArray_ar.push( stringToAdd );
                trustedMaxResult_str.fill(0);
            }
        }
        else
        {
            resultsArray_ar.push('');
            if (interval == true)
            {
                trustedMinResultsArray_ar.push('');
                trustedMaxResultsArray_ar.push('');
            }
        }
    }

    let return_arr = 
    { 
        'number-of-multiple-computations': numberOfComputations, 
        'handle_diafanisComputations': handle_diafanisComputation_str_ar,
        'hasError': hasError,
        'results': resultsArray_ar,
        'interval-min-results': trustedMinResultsArray_ar,
        'interval-max-results': trustedMaxResultsArray_ar,
        'error-type-numbers': errorTypesArray_ar,
        'time-calculate': timeCalculate.toFixed(6) + 's',
        'version-number': versionNumber
    };

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(return_arr));

    if (debugEnabled == true)
        console.log(`time to calculate: ${timeCalculate.toFixed(6) + 's'}`);

    for (iCount = 0; iCount < numberOfComputations; iCount++)
    {
        position = findComputationPos(handle_diafanisComputation_str_ar[iCount]);
        if (position >= 0)
        {       
            diafanisComputations_arr[position][2] = Date.now().valueOf() + deleteTimeout; //[2] milliseconds timeout to delete (0 means no timeout)
   
            if (debugEnabled == true)
                console.log(`deletion timer prolonged by 1 hour for computation handle_diafanisComputation: ${handle_diafanisComputation_str_ar[iCount]}`);
        }
        else
        {
            if (debugEnabled == true)
                console.log(`computation does not exist handle_diafanisComputation: ${handle_diafanisComputation_str_ar[iCount]}`);
        } 
    }

    if (debugEnabled == true)
        console.log(`number of active computations: ${numberOfActiveComputations}`);
  
    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);
}

function handleGetComputationInformationXML(req, res)
{
    let handle_diafanisComputation_str;
    let existingComputation = false;

    if (req.query.handle_diafanisComputation != null) //GET   
    {
        handle_diafanisComputation_str = req.query.handle_diafanisComputation;
    }
    else //POST   
    {
        handle_diafanisComputation_str = req.body.handle_diafanisComputation;
    }

    if (debugEnabled == true)
        console.log(`handle get information as XML from computation handle_diafanisComputation: ${handle_diafanisComputation_str} - timestamp: ${new Date().toISOString()}`);

    let handle_diafanisComputation = null;
    let position = -1;

    if (handle_diafanisComputation_str != null)
    {
        position = findComputationPos(handle_diafanisComputation_str);
        if (position >= 0)
        {
            if (debugEnabled == true)
                console.log(`reuse computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);

            handle_diafanisComputation = diafanisComputations_arr[position][1]; //[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
            diafanisComputations_arr[position][2] = 0; //[2] milliseconds timeout to delete (0 means no timeout)
            
            existingComputation = true;
        }
        else
        {
            res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
            return;
        }
    }
    else
    {
        res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
        return;
    }

    let handle_diafanisComputation_addr = handle_diafanisComputation.address();

    let maxLengthXML = mathEngineLibrary_ffi.pacevalLibrary_GetComputationInformationXML(handle_diafanisComputation, null);
    let informationXML_str = Buffer.alloc(maxLengthXML, 0, 'ascii');
    maxLengthXML = mathEngineLibrary_ffi.pacevalLibrary_GetComputationInformationXML(handle_diafanisComputation,
                   informationXML_str);
                   
    let diafanisVersion_str = Buffer.alloc(2000, 0, 'ascii');
    mathEngineLibrary_ffi.pacevalLibrary_GetComputationVersionString(handle_diafanisComputation,
        diafanisVersion_str);

    let errorType = ref.alloc('int');
    if (versionNumber == 0)
        versionNumber = mathEngineLibrary_ffi.pacevalLibrary_dmathv(null, errorType, 'paceval_VersionNumber', 0, '', null);

    let return_arr =
    {
        'handle_diafanisComputation': handle_diafanisComputation_addr,
        'information-XML': informationXML_str.toString().replace(/(?:\\[rn]|[\r\n])/g,'<br>').replace(/\0/g, ''),
        'version-details': diafanisVersion_str.toString().replace(/\0/g, ''),
        'version-number': versionNumber
    }; 

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(return_arr));

    diafanisComputations_arr[position][2] = Date.now().valueOf() + deleteTimeout; //[2] milliseconds timeout to delete (0 means no timeout)
   
    if (debugEnabled == true)
    {
        console.log(`deletion timer prolonged by 1 hour for computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
        console.log(`number of active computations: ${numberOfActiveComputations}`);
    }
    
    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);
}

function handleGetErrorInformation(req, res)
{
    let handle_diafanisComputation_str;
    let existingComputation = false;
    let hasError = false;

    if (req.query.handle_diafanisComputation != null) //GET  
    {
        handle_diafanisComputation_str = req.query.handle_diafanisComputation;
    }
    else //POST    
    {
        handle_diafanisComputation_str = req.body.handle_diafanisComputation;
    }

    if (debugEnabled == true)
        console.log(`handle get error information from computation handle_diafanisComputation: ${handle_diafanisComputation_str} - timestamp: ${new Date().toISOString()}`);

    let handle_diafanisComputation = null;
    let position = -1;

    if (handle_diafanisComputation_str != null)
    {
        position = findComputationPos(handle_diafanisComputation_str);
        if (position >= 0)
        {
            if (debugEnabled == true)
                console.log(`reuse computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);

            handle_diafanisComputation = diafanisComputations_arr[position][1]; //[1] 'pointer' returned from mathEngineLibrary_ffi.pacevalLibrary_CreateComputation()
            diafanisComputations_arr[position][2] = 0; //[2] milliseconds timeout to delete (0 means no timeout)
            
            existingComputation = true;
        }
        else
        {
            res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
            return;
        }
    }
    else
    {
        res.status(500).json({ error: 'handle_diafanisComputation does not exist' });
        return;
    }
    
    let handle_diafanisComputation_addr = handle_diafanisComputation.address();
    
    hasError = mathEngineLibrary_ffi.pacevalLibrary_GetIsError(handle_diafanisComputation);
    
    let maxLengthStr = mathEngineLibrary_ffi.pacevalLibrary_CreateErrorInformationText(handle_diafanisComputation, null, null);
    let errorMessage_str = Buffer.alloc(maxLengthStr, 0, 'ascii');
    let errorDetails_str = Buffer.alloc(maxLengthStr, 0, 'ascii');
    maxLengthStr = mathEngineLibrary_ffi.pacevalLibrary_CreateErrorInformationText(handle_diafanisComputation,
                   errorMessage_str, errorDetails_str); 
        
    let errorOperator_str = Buffer.alloc(255, 0, 'ascii');
    let errorPosition = ref.alloc('int32');
    let errorPositionLong = -1;
    
    let errorTypeNumer = mathEngineLibrary_ffi.pacevalLibrary_GetErrorInformation(handle_diafanisComputation, errorOperator_str, errorPosition); 
        
    if (errorPosition.deref() == -1)
        errorPositionLong = '';
    else
        errorPositionLong = errorPosition.deref();
    
    let errorType = ref.alloc('int');
    if (versionNumber == 0)
        versionNumber = mathEngineLibrary_ffi.pacevalLibrary_dmathv(null, errorType, 'paceval_VersionNumber', 0, '', null);

    let return_arr =
    {
        'handle_diafanisComputation': handle_diafanisComputation_addr,
        'hasError': hasError,
        'error-type-number': errorTypeNumer,
        'error-position': errorPositionLong,
        'error-operator': errorOperator_str.toString().replace(/\0/g, ''),
        'error-type': errorDetails_str.toString().replace(/\0/g, ''),
        'error-message': errorMessage_str.toString().replace(/\0/g, ''),
        'version-number': versionNumber
    }; 
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(return_arr));

    diafanisComputations_arr[position][2] = Date.now().valueOf() + deleteTimeout; //[2] milliseconds timeout to delete (0 means no timeout)
   
    if (debugEnabled == true)
    {
        console.log(`deletion timer prolonged by 1 hour for computation handle_diafanisComputation: ${handle_diafanisComputation_str}`);
        console.log(`number of active computations: ${numberOfActiveComputations}`); 
    }
    
    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);
}

function handleGETandPOST(req, res, urlGET, urlPOST)
{
    let handle_diafanisComputation_str = '';

    numberOfRequestslastGC++;
    if ((req.query.call != null) || (urlGET != null)) //GET
    {
        if ((req.query.call == 'diafanis_CreateComputation') || (urlGET == 'CreateComputation'))  
        {
            if ((req.query.functionString == null) || (req.query.numberOfVariables == null) || (req.query.variables == null) || (req.query.interval == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleCreateComputation(req, res, true);
            return;
        }
        else if ((req.query.call == 'diafanis_GetComputationResult') || (urlGET == 'GetComputationResult'))  
        {
            if ((req.query.handle_diafanisComputation == null) || (req.query.values == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleGetComputationResult(req, res, null);
            return;
        }
        else if ((req.query.call == 'diafanis_GetComputationResultExt') || (urlGET == 'GetComputationResultExt'))  
        {
            if ((req.query.handle_diafanisComputation == null) || (req.query.numberOfCalculations == null) || (req.query.values == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleGetComputationResultExt(req, res);
            return;
        }
        else if ((req.query.call == 'diafanis_GetMultipleComputationsResults') || (urlGET == 'GetMultipleComputationsResults')) 
        {
            if ((req.query.handle_diafanisComputations == null) || (req.query.numberOfdiafanisComputations == null) || (req.query.values == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
        
            handleGetMultipleComputationsResults(req, res);
            return;
        }
        else if ((req.query.call == 'diafanis_GetErrorInformation') || (urlGET == 'GetErrorInformation')) 
        {
            if (req.query.handle_diafanisComputation == null)   
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
        
            handleGetErrorInformation(req, res);
            return;
        }
        else if ((req.query.call == 'diafanis_GetComputationInformationXML') || (urlGET == 'GetComputationInformationXML'))  
        {
            if (req.query.handle_diafanisComputation == null)   
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
        
            handleGetComputationInformationXML(req, res);
            return;
        }
        else if ((req.query.call == 'diafanis') || (urlGET == 'Demo'))   
        {
            if ((req.query.functionString == null) || (req.query.numberOfVariables == null) || (req.query.variables == null) || (req.query.values == null) || (req.query.interval == null)) 
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }       
            
            if (req.query.handle_diafanisComputation == null)
                handle_diafanisComputation_str = handleCreateComputation(req, res, false);
            else
                handle_diafanisComputation_str = req.query.handle_diafanisComputation;

            handleGetComputationResult(req, res, handle_diafanisComputation_str);

            handle_diafanisComputation_str = null;
            return;
        }
        else 
        {
            res.status(500).json({ error: 'missing parameters' });
            return;
        }
    }
    else if ((req.body.call != null) || (urlPOST != null)) //POST
    {
        if ((req.body.call == 'diafanis_CreateComputation') || (urlPOST == 'CreateComputation'))  
        {
            if ((req.body.functionString == null) || (req.body.numberOfVariables == null) || (req.body.variables == null) || (req.body.interval == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleCreateComputation(req, res, true);
            return;
        }
        else if ((req.body.call == 'diafanis_GetComputationResult') || (urlPOST == 'GetComputationResult'))  
        {
            if ((req.body.handle_diafanisComputation == null) || (req.body.values == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleGetComputationResult(req, res, null);
            return;
        }
        else if ((req.body.call == 'diafanis_GetComputationResultExt') || (urlPOST == 'GetComputationResultExt'))  
        {
            if ((req.body.handle_diafanisComputation == null) || (req.body.numberOfCalculations == null) || (req.body.values == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleGetComputationResultExt(req, res);
            return;
        }
        else if ((req.body.call == 'diafanis_GetMultipleComputationsResults') || (urlPOST == 'GetMultipleComputationsResults'))  
        {
            if ((req.body.handle_diafanisComputations == null) || (req.body.numberOfdiafanisComputations == null) || (req.body.values == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
            
            handleGetMultipleComputationsResults(req, res);
            return;
        }
        else if ((req.body.call == 'diafanis_GetErrorInformation') || (urlPOST == 'GetErrorInformation'))  
        {
            if (req.body.handle_diafanisComputation == null)  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
        
            handleGetErrorInformation(req, res);
            return;
        }
        else if ((req.body.call == 'diafanis_GetComputationInformationXML') || (urlPOST == 'GetComputationInformationXML'))  
        {
            if (req.body.handle_diafanisComputation == null)   
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }
        
            handleGetComputationInformationXML(req, res);
            return;
        }
        else if ((req.body.call == 'diafanis') || (urlPOST == 'Demo'))  
        {
            if ((req.body.functionString == null) || (req.body.numberOfVariables == null) || (req.body.variables == null) || (req.body.values == null) || (req.body.interval == null))  
            {
                res.status(500).json({ error: 'missing parameters' });
                return;
            }   
            
            if (req.body.handle_diafanisComputation == null)  
                handle_diafanisComputation_str = handleCreateComputation(req, res, false);
            else
                handle_diafanisComputation_str = req.body.handle_diafanisComputation; 

            handleGetComputationResult(req, res, handle_diafanisComputation_str);

            handle_diafanisComputation_str = null;
            return;
        }
        else 
        {
            res.status(500).json({ error: 'missing parameters' });
            return;
        }
    }

    res.status(500).json({ error: 'missing parameters' });
    return;
}; 

app.get('/', (req, res) =>
{
    handleGETandPOST(req, res, null, null);
});

app.post('/', (req, res) =>
{
    handleGETandPOST(req, res, null, null);
});

app.get('/Demo/', (req, res) =>
{
    handleGETandPOST(req, res, 'Demo', null);
});

app.post('/Demo/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'Demo');
});

app.get('/CreateComputation/', (req, res) =>
{
    handleGETandPOST(req, res, 'CreateComputation', null);
});

app.post('/CreateComputation/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'CreateComputation');
});

app.get('/GetComputationResult/', (req, res) =>
{
    handleGETandPOST(req, res, 'GetComputationResult', null);
});

app.post('/GetComputationResult/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'GetComputationResult');
});

app.get('/GetComputationResultExt/', (req, res) =>
{
    handleGETandPOST(req, res, 'GetComputationResultExt', null);
});

app.post('/GetComputationResultExt/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'GetComputationResultExt');
});

app.get('/GetMultipleComputationsResults/', (req, res) =>
{
    handleGETandPOST(req, res, 'GetMultipleComputationsResults', null);
});

app.post('/GetMultipleComputationsResults/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'GetMultipleComputationsResults');
});

app.get('/GetErrorInformation/', (req, res) =>
{
    handleGETandPOST(req, res, 'GetErrorInformation', null);
});

app.post('/GetErrorInformation/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'GetErrorInformation');
});

app.get('/GetComputationInformationXML/', (req, res) =>
{
    handleGETandPOST(req, res, 'GetComputationInformationXML', null);
});

app.post('/GetComputationInformationXML/', (req, res) =>
{
    handleGETandPOST(req, res, null, 'GetComputationInformationXML');
});

// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
{
    setTimeout(deleteComputationTimer, deleteTimeout); 
    console.log(`diafanis-service listening on port ${PORT}...`);
    logMemoryUsed();
    if (debugEnabled == true)
        console.log(``);
});
