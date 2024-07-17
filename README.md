![10019436_l-e1442994613885 2](https://paceval.com/wp-content/uploads/2022/10/Eclipse-Diafanis.jpg)

# Eclipse Diafanis - the Mathematical Engine as a Service (e.g. for multi-party computations), 4.25 OAS3

SwaggerHub - <https://app.swaggerhub.com/apis/diafanis/diafanis-service>

This Mathematical Engine as a Service provides a powerful and fast remote math coprocessor service for IoT solutions based on a Linux server for x64 (Intel and AMD) or ARM64 (e.g. Raspberry Pi or APPLE M1/M2) processors. Equipped with a simple interface, it will allow battery-powered devices to perform complex mathematical operations remotely and very quickly, avoiding increasing power consumption of the device itself.

[http://diafanis.cloud/Demo/?functionString=-sin(x\*cos(x))\^(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes](http://diafanis.cloud/Demo/?functionString=-sin(x*cos(x))%5e(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes)

This creates a calculation object for the function "-sin(x\*cos(x))\^(1/y)" and immediately performs the calculation with the "2" variables "x; y" for the values "0.5; 2". Variables and values are always separated by a ";". With "interval=yes" it is indicated that in addition to the computer-precise calculation, the upper and lower interval of the calculation is also given. The exact value of the calculation is then in this interval.

Of course, you can specify any mathematical function and any number of variables and also other and longer variable names. :)

In addition, with the calculation you receive a reference to the generated calculation object for the function. From now on you can simply use this reference to get calculations for further values. References are valid for 1 hour, which is extended to 1 hour from the time of access each time a reference is accessed. If only the reference to a calculation object is used, the sometimes very long function does not have to be passed every time. That saves time and computing power. For example, if you have received a reference "handle_Computation: 115626720", simply call up the following URL for a further calculation with the values 0.46577 for x and 2.61 for y:

http://diafanis.cloud/GetComputationResult/?handle_diafanisComputation=115626720&values=0.46577;2.61

GET –

```
curl -X GET -k "http://diafanis.cloud:80/Demo/?functionString=-sin(x*cos(x))^(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes"
```

or POST –

```
curl --data "functionString=-sin(x*cos(x))^(1/y)&numberOfVariables=2&variables=x;y&values=0.5;2&interval=yes" -X POST http://diafanis.cloud:80/Demo/
```

Note: Use the correct encoding in the functionString in the URL (GET) and data (POST) (e.g. replace the ‘+’ character with ‘%2B’).

This allows you to perform complex calculations of any length and with any number of variables on the server. Please note that this is our test server. :) This test server is a 4-core ARM64 Linux server with only 4GB of memory, although it's pretty fast.

```
sudo docker pull diafanis/diafanis-service_linux_x64:latest

sudo docker run -p 8080:8080 -d diafanis/diafanis-service_linux_x64
```

LINUX FOR ARM64 PROCESSORS (e.g. Raspberry Pi or APPLE M1/M2)

```
sudo docker pull diafanis/diafanis-service_linux_arm64:latest

sudo docker run -p 8080:8080 -d diafanis/diafanis-service_linux_arm64
```

diafanis - Website https://projects.eclipse.org/projects/iot.diafanis/developer 
<br>Send email to diafanis mailto:info@diafanis.cloud

![10019436_l-e1442994613885 2](https://projects.eclipse.org/sites/default/files/Screenshot%202022-11-30%20171253.png)
