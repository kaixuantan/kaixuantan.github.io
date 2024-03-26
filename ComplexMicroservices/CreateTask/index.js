require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const swaggerUI = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT;
const SubGrpAppId = process.env.SubGrpAppId;
const SubGrpKey = process.env.SubGrpKey;
const TaskAppId = process.env.TaskAppId;
const TaskKey = process.env.TaskKey;

// RabbitMQ connection details
const rabbitmq_host = process.env.RABBITMQ_HOST;
const rabbitmq_port = process.env.RABBITMQ_PORT;
const rabbitmq_exchange = process.env.EXCHANGE_NAME;
const rabbitmq_exchange_type = process.env.EXCHANGE_TYPE;
const rabbitmq_log_routing_key = process.env.LOG_ROUTING_KEY;
const rabbitmq_notif_routing_key = process.env.NOTIF_ROUTING_KEY;

// Email server details
const smtp_server = process.env.SMTP_SERVER;
const smtp_port = process.env.SMTP_PORT;
const smtp_username = process.env.SMTP_USERNAME;
const smtp_password = process.env.SMTP_PASSWORD;
const test_email = process.env.TEST_EMAIL;

// Serve Swagger documentation
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerSpec));

/**
 * @swagger
 * /subgroup/{subGroupId}:
 *   get:
 *     summary: Get subgroup by ID
 *     description: Retrieve a subgroup by its ID.
 *     parameters:
 *       - in: path
 *         name: subGroupId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the subgroup to retrieve
 *     responses:
 *       '200':
 *         description: Successful operation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Subgroup'
 *       '404':
 *         description: Subgroup not found
 */
app.get('/subgroup/:subGroupId', async (req, res) => {
    try {
        const subGroupId = req.params.subGroupId;
    
        const subGrpResponse = await axios.get(`https://personal-rc7vnnm9.outsystemscloud.com/SubGroupAPI_REST/rest/v1/subgroup/${subGroupId}`, {
            headers: {
                'X-SubGroup-AppId': SubGrpAppId,
                'X-SubGroup-Key': SubGrpKey,
            }
        });

        const users = subGrpResponse.data.SubGroup.subGroupUsers;
        
        users.forEach(obj => {
            obj.assigneeUserId = obj.userId;
            obj.assigneeUsername = obj.username;
            delete obj.userId; 
            delete obj.username;
        });

        res.json(users);
    } catch (error) {
        if (error.code === 'ERR_BAD_RESPONSE') {
            res.status(500).json({ error: 'Internal Server Error' });
        } else {
            res.status(error.response.status).json({ 
                code: error.response.status + " " + error.response.statusText,
                error: error.response.data.Result.ErrorMessage
            });
        }
    }
});

/**
 * @swagger
 * /task:
 *   post:
 *     summary: Create a new task
 *     description: Create a new task with the provided details
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskName:
 *                 type: string
 *                 description: The name of the task
 *               taskDesc:
 *                 type: string
 *                 description: The description of the task
 *               dueDateTime:
 *                 type: string
 *                 format: date-time
 *                 description: The due date and time of the task
 *               subGroupId:
 *                 type: integer
 *                 description: The ID of the subgroup to which the task belongs
 *               userId:
 *                 type: integer
 *                 description: The ID of the user creating the task
 *               username:
 *                 type: string
 *                 description: The username of the user creating the task
 *               assignedTo:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     taskId:
 *                       type: integer
 *                       description: The ID of the task
 *                     assigneeUserId:
 *                       type: integer
 *                       description: The ID of the user assigned to the task
 *                     assigneeUsername:
 *                       type: string
 *                       description: The username of the user assigned to the task
 *     responses:
 *       '201':
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Confirmation message
 *                 taskId:
 *                   type: integer
 *                   description: The ID of the newly created task
 *       '400':
 *         description: Bad request, invalid input data
 *       '500':
 *         description: Internal server error
 */
app.post('/task', async (req, res) => {
    // Connect to RabbitMQ to send log
    const connection = await amqp.connect(`amqp://${rabbitmq_host}:${rabbitmq_port}`);
    const channel = await connection.createChannel();

    // Assert Exchange
    await channel.assertExchange(rabbitmq_exchange, rabbitmq_exchange_type, { durable: true });
    var taskId = 0;

    try {
        const createTaskResponse = await axios.post(
            `https://personal-rc7vnnm9.outsystemscloud.com/TaskAPI_REST/rest/v1/task`,
            {
                name: req.body.taskName,
                description: req.body.taskDesc,
                dueDateTime: req.body.dueDateTime,
                subGroupId: req.body.subGroupId,
                createdById: req.body.userId,
                createdByUsername: req.body.username
            }, 
            {
                headers: {
                    'Content-Type': "application/json",
                    'X-Task-AppId': TaskAppId,
                    'X-Task-Key': TaskKey,
                }
            }
        );

        taskId = createTaskResponse.data.TaskId;

        await axios.put(
            `https://personal-rc7vnnm9.outsystemscloud.com/TaskAPI_REST/rest/v1/task/assign/${taskId}`,
            req.body.assignedTo,
            {
                headers: {
                    'X-Task-AppId': TaskAppId,
                    'X-Task-Key': TaskKey,
                    'assignorId': req.body.userId,
                    'assignorUsername': req.body.username
                }
            }
        )

        res.status(201).json({ message: 'Task created successfully', taskId });
        
        var timestamp = getSingaporeTimestamp();

        // for log
        const message = {
            userId: req.body.userId,
            subGroupId: req.body.subGroupId,
            taskId: taskId,
            type: 'Create Task',
            description: 'This is a test log message.',
            timestamp: timestamp
        };

        // send msg to the exchange
        await channel.publish(rabbitmq_exchange, rabbitmq_log_routing_key, Buffer.from(JSON.stringify(message)), { persistent: true });
        console.log(`Message sent to the exchange '${rabbitmq_exchange}' with routing key '${rabbitmq_log_routing_key}'.`);

        // for notif
        const notifMsg = {
            recipient: test_email,
            subject: 'Test Notification',
            body: 'This is a test notification message for RabbitMQ.'
        };

        // Send the message to RabbitMQ
        await channel.publish(rabbitmq_exchange, rabbitmq_notif_routing_key, Buffer.from(JSON.stringify(notifMsg)), { persistent: true });
        console.log(`Message sent to RabbitMQ exchange '${rabbitmq_exchange}' with routing key '${rabbitmq_notif_routing_key}'.`);

        const formattedDate = formatDate(req.body.dueDateTime);
        const taskURL = `http://localhost:5173/task/${taskId}`;

        const mailOptions = {
            from: smtp_username,
            to: test_email, // NEED TO GET EMAIL
            subject: '[TaskMaster] New Task Alert',
            text: `
                Hello ${req.body.assignedTo.map(assignee => `${assignee.assigneeUsername}`).join(', ')}!

                A new task has been created:
                Task Name: ${req.body.taskName}
                Description: ${req.body.taskDesc}
                Due On: ${formattedDate}
                Assignees:
                ${req.body.assignedTo.map(assignee => `- ${assignee.assigneeUsername}`).join('\n')}

                You can login to view the task details here: ${taskURL}

                Best regards,
                TaskMaster`
        };

        await sendEmail(mailOptions);

    } catch (error) {
        console.log(error)
        if (error.code === 'ERR_BAD_RESPONSE') {
            res.status(500).json({ error: 'Internal Server Error' });

            // for log
            var timestamp = getSingaporeTimestamp();

            const message = {
                userId: req.body.userId,
                subGroupId: req.body.subGroupId,
                taskId: taskId,
                type: 'Error in Create Task',
                description: 'Internal Server Error',
                timestamp: timestamp
            };

            // send msg to the exchange
            await channel.publish(rabbitmq_exchange, rabbitmq_log_routing_key, Buffer.from(JSON.stringify(message)), { persistent: true });
            console.log(`Message sent to the exchange '${rabbitmq_exchange}' with routing key '${rabbitmq_log_routing_key}'.`);
        } else if (error.response.status) {
            res.status(error.response.status).json({ 
                code: error.response.status + " " + error.response.statusText,
                error: error.response.data.Result.ErrorMessage
            });

            // for log
            var timestamp = getSingaporeTimestamp();

            const message = {
                userId: req.body.userId,
                subGroupId: req.body.subGroupId,
                taskId: taskId,
                type: 'Error in Create Task',
                description: error.response.data.Result.ErrorMessage,
                timestamp: timestamp
            };

            // send msg to the exchange
            await channel.publish(rabbitmq_exchange, rabbitmq_log_routing_key, Buffer.from(JSON.stringify(message)), { persistent: true });
            console.log(`Message sent to the exchange '${rabbitmq_exchange}' with routing key '${rabbitmq_log_routing_key}'.`);

        } else {
            res.status(500).json({ error: error });

            // for log
            var timestamp = getSingaporeTimestamp();

            const message = {
                userId: req.body.userId,
                subGroupId: req.body.subGroupId,
                taskId: taskId,
                type: 'Error in Create Task',
                description: error,
                timestamp: timestamp
            };

            // send msg to the exchange
            await channel.publish(rabbitmq_exchange, rabbitmq_log_routing_key, Buffer.from(JSON.stringify(message)), { persistent: true });
            console.log(`Message sent to the exchange '${rabbitmq_exchange}' with routing key '${rabbitmq_log_routing_key}'.`);

        }
    } finally {
        if (channel) await channel.close();
        if (connection) await connection.close();
    }
});

function getSingaporeTimestamp() {
    const currentDate = new Date();
    const sgTimezoneOffset = 8 * 60; // Offset in minutes
    const singaporeTime = new Date(currentDate.getTime() + sgTimezoneOffset * 60000);
    return singaporeTime.toISOString();
}

async function sendEmail(mailOptions) {
    const transporter = nodemailer.createTransport({
        host: smtp_server,
        port: smtp_port,
        auth: {
            user: smtp_username,
            pass: smtp_password
        }
    });

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
        } else {
            console.log('Email sent:', info.response);
        }
    });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const options = {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    return date.toLocaleString('en-US', options);
}

app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});
