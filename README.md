![10019436_l-e1442994613885 2](https://paceval.com/wp-content/uploads/2022/10/Eclipse-Diafanis.jpg)<br>

# Eclipse Diafanis - the Mathematical Engine as a Service (e.g. for multi-party computations), 4.04 OAS3
SwaggerHub - https://app.swaggerhub.com/apis/diafanis/diafanis-service/4.04

<br>
<b>WHY DO I NEED A MATHEMATICAL ENGINE?</b>
<br><br>
Many connected devices or so-called IoT solutions require <b>complex mathematical calculations to work correctly or make decisions.</b>. This can be, for example, a smartphone or a remote device that performs predictive analysis or a self-flying drone that evaluates objects in recorded videos or images <b>in real time during flight</b>. These devices do not have the computing power to perform such mathematical calculations themselves. Or these devices, because they are battery powered, can't even do the <b>intensive math calculations because that consumes battery time.</b>.

<b>This Mathematical Engine as a Service</b> provides a powerful and fast <b>remote math coprocessor service for IoT solutions</b> based on a Linux server for x64 (Intel and AMD) or ARM64 (e.g. Raspberry Pi or APPLE M1/M2) processors. Equipped with a simple interface, it will allow battery-powered devices to perform complex mathematical operations remotely and very quickly, <b>avoiding increasing power consumption of the device itself</b>.

<br>
<b>HOW CAN I USE CALCULATIONS WITH THIS MATHEMATICAL ENGINE?</b>
<br><br>
To create a calculation the device simply calls the following URL:

http://diafanis.cloud/Demo/?functionString=-sin(x*cos(x))^(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes

This creates a calculation object for the function "-sin(x*cos(x))^(1/y)" and immediately performs the calculation with the "2" variables "x; y" for the values "0.5; 2". Variables and values are always separated by a ";". With "interval=yes" it is indicated that <b>in addition to the computer-precise calculation, the upper and lower interval of the calculation is also given</b>. The exact value of the calculation is then in this interval.

Of course you can specify any mathematical function and any number of variables and also other and longer variable names. :)

In addition, with the calculation you receive a reference to the generated calculation object for the function. From now on you can simply use this reference to get calculations for further values. <b>References are valid for 1 hour</b>, which is extended to 1 hour from the time of access each time a reference is accessed. If only the reference to a calculation object is used, the sometimes very long function does not have to be passed every time. <b>That saves time and computing power.</b> For example, if you have received a reference "handle_Computation: <b>115626720</b>", simply call up the following URL for a further calculation with the values 0.46577 for x and 2.61 for y:

http://diafanis.cloud/GetComputationResult/?handle_diafanisComputation=115626720&values=0.46577;2.61

<br>
You can also run cUrl instructions with your command line or your IoT device directly on our test server (http://diafanis.cloud), like the following:

<b>GET</b> –

    curl -X GET -k "http://diafanis.cloud:80/Demo/?functionString=-sin(x*cos(x))^(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes"

or <b>POST</b> –

    curl --data "functionString=-sin(x*cos(x))^(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes" -X POST http://diafanis.cloud:80/Demo/

<b>Note:</b> Use the correct encoding in the functionString in the URL (GET) and data (POST) (e.g. replace the ‘+’ character with ‘%2B’).

This allows you to <b>perform complex calculations of any length and with any number of variables on the server</b>. Please note that this is our test server. :) This test server is a 4-core ARM64 Linux server with only 4GB of memory, although it's pretty fast.

<br>
<b>HOW CAN I GET THIS MATHEMATICAL ENGINE ON MY OWN SERVER?</b>
<br><br>
Just run this command line in the terminal to get and start the service with Docker:

LINUX FOR x64 PROCESSORS (Intel and AMD)

    sudo docker pull diafanis/diafanis-service_linux_x64:latest

    sudo docker run -p 8080:8080 -d diafanis/diafanis-service_linux_x64

LINUX FOR ARM64 PROCESSORS (e.g. Raspberry Pi or APPLE M1/M2)

    sudo docker pull diafanis/diafanis-service_linux_arm64:latest

    sudo docker run -p 8080:8080 -d diafanis/diafanis-service_linux_arm64

diafanis - Website https://projects.eclipse.org/projects/iot.diafanis/developer

Send email to diafanis mailto:info@diafanis.cloud
