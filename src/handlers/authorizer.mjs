import {createRemoteJWKSet, jwtVerify} from 'jose';

const USER_POOL_ID = process.env.USER_POOL_ID
const APP_CLIENT_ID = process.env.APP_CLIENT_ID
const ADMIN_GROUP_NAME = process.env.ADMIN_GROUP_NAME

let isColdStart = true;
let keys = {}

const decodeHeader = (token) => {
    try {
        const parts = token.split('.');

        const header = parts[0];
        const base64 = header.replace(/-/g, '+').replace(/_/g, '/');

        const decoded = atob(base64);

        return JSON.parse(decoded);
    } catch (error) {
        console.error('Invalid JWT header:', error);
        throw error;
    }
}

const validateToken = async (token, region) => {
    try {
        const keysUrl = `https://cognito-idp.${region}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`;

        // Load JWKS on cold start
        if (isColdStart) {
            const response = await fetch(keysUrl);
            const jwks = await response.json();
            keys = jwks.keys;
            isColdStart = false;
        }

        const unverifiedHeaders = decodeHeader(token)
        if (!unverifiedHeaders) {
            throw new Error('Failed to decode JWT header');
        }
        const kid = unverifiedHeaders.kid;

        const key = keys.find((key) => key.kid === kid);
        if (!key) {
            console.error('Public key not found in JWKS');
            return false;
        }

        // Verify the token signature using the key
        const JWKS = createRemoteJWKSet(new URL(keysUrl));
        const {payload} = await jwtVerify(token, JWKS, {
            audience: APP_CLIENT_ID, // Verify the audience
        });

        console.log('Signature successfully verified:', payload);

        const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
        if (payload.exp && currentTime > payload.exp) {
            console.error('Token is expired');
            return false;
        }

        if (payload.aud !== APP_CLIENT_ID) {
            console.error('Token was not issued for this audience');
            return false;
        }

        return payload;
    } catch (err) {
        console.error('Token validation failed:', err.message);
        return false;
    }
}

export const handler = async (event, context) => {
    const tmp = event['methodArn'].split(':')
    const apiGatewayArnTmp = tmp[5].split('/')
    const region = tmp[3]
    const awsAccountId = tmp[4]

    const validatedDecodedToken = await validateToken(event['authorizationToken'], region)
    if (!validatedDecodedToken) {
        throw new Error('Unable to validate token');
    }

    const principalId = validatedDecodedToken['sub'];

    const policy = new AuthPolicy(principalId, awsAccountId)

    policy.restApiId = apiGatewayArnTmp[0];
    policy.region = region;
    policy.stage = apiGatewayArnTmp[1];

    policy.allowMethod(AuthPolicy.HttpVerb.GET, '/images/myImages');
    policy.allowMethod(AuthPolicy.HttpVerb.GET, '/images/feed');
    policy.allowMethod(AuthPolicy.HttpVerb.GET, '/images/share/{id}');
    policy.allowMethod(AuthPolicy.HttpVerb.POST, `/upload`);
    policy.allowMethod(AuthPolicy.HttpVerb.DELETE, '/images/{id}');

    const response = {...policy.build()};
    response.context = {
        email: validatedDecodedToken['email'],
        username: validatedDecodedToken['name'],
    };

    return response
}

/**
 * AuthPolicy receives a set of allowed and denied methods and generates a valid
 * AWS policy for the API Gateway authorizer. The constructor receives the calling
 * user principal, the AWS account ID of the API owner, and an apiOptions object.
 * The apiOptions can contain an API Gateway RestApi Id, a region for the RestApi, and a
 * stage that calls should be allowed/denied for. For example
 * {
 *   restApiId: "xxxxxxxxxx",
 *   region: "us-east-1",
 *   stage: "dev"
 * }
 *
 * const testPolicy = new AuthPolicy("[principal user identifier]", "[AWS account id]", apiOptions);
 * testPolicy.allowMethod(AuthPolicy.HttpVerb.GET, "/users/username");
 * testPolicy.denyMethod(AuthPolicy.HttpVerb.POST, "/pets");
 * context.succeed(testPolicy.build());
 *
 * @class AuthPolicy
 * @constructor
 */
function AuthPolicy(principal, awsAccountId, apiOptions) {
    /**
     * The AWS account id the policy will be generated for. This is used to create
     * the method ARNs.
     *
     * @property awsAccountId
     * @type {String}
     */
    this.awsAccountId = awsAccountId;

    /**
     * The principal used for the policy, this should be a unique identifier for
     * the end user.
     *
     * @property principalId
     * @type {String}
     */
    this.principalId = principal;

    /**
     * The policy version used for the evaluation. This should always be "2012-10-17"
     *
     * @property version
     * @type {String}
     * @default "2012-10-17"
     */
    this.version = "2012-10-17";

    /**
     * The regular expression used to validate resource paths for the policy
     *
     * @property pathRegex
     * @type {RegExp}
     * @default '^\/[/.a-zA-Z0-9-\*]+$'
     */
    this.pathRegex = new RegExp('^[/.a-zA-Z0-9-*{}]+$');

    // these are the internal lists of allowed and denied methods. These are lists
    // of objects and each object has 2 properties: A resource ARN and a nullable
    // conditions statement.
    // the build method processes these lists and generates the approriate
    // statements for the final policy
    this.allowMethods = [];
    this.denyMethods = [];

    if (!apiOptions || !apiOptions.restApiId) {
        // Replace the placeholder value with a default API Gateway API id to be used in the policy.
        // Beware of using '*' since it will not simply mean any API Gateway API id, because stars will greedily expand over '/' or other separators.
        // See https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html for more details.
        this.restApiId = "<<restApiId>>";
    } else {
        this.restApiId = apiOptions.restApiId;
    }
    if (!apiOptions || !apiOptions.region) {
        // Replace the placeholder value with a default region to be used in the policy.
        // Beware of using '*' since it will not simply mean any region, because stars will greedily expand over '/' or other separators.
        // See https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html for more details.
        this.region = "<<region>>";
    } else {
        this.region = apiOptions.region;
    }
    if (!apiOptions || !apiOptions.stage) {
        // Replace the placeholder value with a default stage to be used in the policy.
        // Beware of using '*' since it will not simply mean any stage, because stars will greedily expand over '/' or other separators.
        // See https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html for more details.
        this.stage = "<<stage>>";
    } else {
        this.stage = apiOptions.stage;
    }
}

/**
 * A set of existing HTTP verbs supported by API Gateway. This property is here
 * only to avoid spelling mistakes in the policy.
 *
 * @property HttpVerb
 * @type {Object}
 */
AuthPolicy.HttpVerb = {
    GET: "GET",
    POST: "POST",
    PUT: "PUT",
    PATCH: "PATCH",
    HEAD: "HEAD",
    DELETE: "DELETE",
    OPTIONS: "OPTIONS",
    ALL: "*"
};

AuthPolicy.prototype = (function () {
    /**
     * Adds a method to the internal lists of allowed or denied methods. Each object in
     * the internal list contains a resource ARN and a condition statement. The condition
     * statement can be null.
     *
     * @method addMethod
     * @param effect {String} The effect for the policy. This can only be "Allow" or "Deny".
     * @param verb {String} The HTTP verb for the method, this should ideally come from the
     *                 AuthPolicy.HttpVerb object to avoid spelling mistakes
     * @param resource {String} The resource path. For example "/pets"
     * @param conditions {Object} The conditions object in the format specified by the AWS docs.
     * @return {void}
     */
    const addMethod = function (effect, verb, resource, conditions) {
        if (verb !== "*" && !AuthPolicy.HttpVerb.hasOwnProperty(verb)) {
            throw new Error("Invalid HTTP verb " + verb + ". Allowed verbs in AuthPolicy.HttpVerb");
        }

        if (!this.pathRegex.test(resource)) {
            throw new Error("Invalid resource path: " + resource + ". Path should match " + this.pathRegex);
        }

        let cleanedResource = resource;
        if (resource.substring(0, 1) === "/") {
            cleanedResource = resource.substring(1, resource.length);
        }
        const resourceArn = "arn:aws:execute-api:" +
            this.region + ":" +
            this.awsAccountId + ":" +
            this.restApiId + "/" +
            this.stage + "/" +
            verb + "/" +
            cleanedResource;

        if (effect.toLowerCase() === "allow") {
            this.allowMethods.push({
                resourceArn: resourceArn,
                conditions: conditions
            });
        } else if (effect.toLowerCase() === "deny") {
            this.denyMethods.push({
                resourceArn: resourceArn,
                conditions: conditions
            })
        }
    };

    /**
     * Returns an empty statement object prepopulated with the correct action and the
     * desired effect.
     *
     * @method getEmptyStatement
     * @param effect{String} The effect of the statement, this can be "Allow" or "Deny"
     * @return {Object} An empty statement object with the Action, Effect, and Resource
     *                  properties prepopulated.
     */
    const getEmptyStatement = function (effect) {
        effect = effect.substring(0, 1).toUpperCase() + effect.substring(1, effect.length).toLowerCase();
        const statement = {};
        statement.Action = "execute-api:Invoke";
        statement.Effect = effect;
        statement.Resource = [];

        return statement;
    };

    /**
     * This function loops over an array of objects containing a resourceArn and
     * conditions statement and generates the array of statements for the policy.
     *
     * @method getStatementsForEffect
     * @param effect{String} The desired effect. This can be "Allow" or "Deny"
     * @param methods{Array} An array of method objects containing the ARN of the resource
     *                and the conditions for the policy
     * @return {Array} an array of formatted statements for the policy.
     */
    const getStatementsForEffect = function (effect, methods) {
        const statements = [];

        if (methods.length > 0) {
            const statement = getEmptyStatement(effect);

            for (let i = 0; i < methods.length; i++) {
                const curMethod = methods[i];
                if (curMethod.conditions === null || curMethod.conditions.length === 0) {
                    statement.Resource.push(curMethod.resourceArn);
                } else {
                    const conditionalStatement = getEmptyStatement(effect);
                    conditionalStatement.Resource.push(curMethod.resourceArn);
                    conditionalStatement.Condition = curMethod.conditions;
                    statements.push(conditionalStatement);
                }
            }

            if (statement.Resource !== null && statement.Resource.length > 0) {
                statements.push(statement);
            }
        }

        return statements;
    };

    return {
        constructor: AuthPolicy,

        /**
         * Adds an allow "*" statement to the policy.
         *
         * @method allowAllMethods
         */
        allowAllMethods: function () {
            addMethod.call(this, "allow", "*", "*", null);
        },

        /**
         * Adds a deny "*" statement to the policy.
         *
         * @method denyAllMethods
         */
        denyAllMethods: function () {
            addMethod.call(this, "deny", "*", "*", null);
        },

        /**
         * Adds an API Gateway method (Http verb + Resource path) to the list of allowed
         * methods for the policy
         *
         * @method allowMethod
         * @param verb{String} The HTTP verb for the method, this should ideally come from the
         *                 AuthPolicy.HttpVerb object to avoid spelling mistakes
         * @param resource{string} The resource path. For example "/pets"
         * @return {void}
         */
        allowMethod: function (verb, resource) {
            addMethod.call(this, "allow", verb, resource, null);
        },

        /**
         * Adds an API Gateway method (Http verb + Resource path) to the list of denied
         * methods for the policy
         *
         * @method denyMethod
         * @param verb{String} The HTTP verb for the method, this should ideally come from the
         *                 AuthPolicy.HttpVerb object to avoid spelling mistakes
         * @param resource{string} The resource path. For example "/pets"
         * @return {void}
         */
        denyMethod: function (verb, resource) {
            addMethod.call(this, "deny", verb, resource, null);
        },

        /**
         * Adds an API Gateway method (Http verb + Resource path) to the list of allowed
         * methods and includes a condition for the policy statement. More on AWS policy
         * conditions here: http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html#Condition
         *
         * @method allowMethodWithConditions
         * @param verb{String} The HTTP verb for the method, this should ideally come from the
         *                 AuthPolicy.HttpVerb object to avoid spelling mistakes
         * @param resource{string} The resource path. For example "/pets"
         * @param conditions{Object} The conditions object in the format specified by the AWS docs
         * @return {void}
         */
        allowMethodWithConditions: function (verb, resource, conditions) {
            addMethod.call(this, "allow", verb, resource, conditions);
        },

        /**
         * Adds an API Gateway method (Http verb + Resource path) to the list of denied
         * methods and includes a condition for the policy statement. More on AWS policy
         * conditions here: http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html#Condition
         *
         * @method denyMethodWithConditions
         * @param verb{String} The HTTP verb for the method, this should ideally come from the
         *                 AuthPolicy.HttpVerb object to avoid spelling mistakes
         * @param resource{string} The resource path. For example "/pets"
         * @param conditions{Object} The conditions object in the format specified by the AWS docs
         * @return {void}
         */
        denyMethodWithConditions: function (verb, resource, conditions) {
            addMethod.call(this, "deny", verb, resource, conditions);
        },

        /**
         * Generates the policy document based on the internal lists of allowed and denied
         * conditions. This will generate a policy with two main statements for the effect:
         * one statement for Allow and one statement for Deny.
         * Methods that includes conditions will have their own statement in the policy.
         *
         * @method build
         * @return {Object} The policy object that can be serialized to JSON.
         */
        build: function () {
            if ((!this.allowMethods || this.allowMethods.length === 0) &&
                (!this.denyMethods || this.denyMethods.length === 0)) {
                throw new Error("No statements defined for the policy");
            }

            const policy = {};
            policy.principalId = this.principalId;
            const doc = {};
            doc.Version = this.version;
            doc.Statement = [];

            doc.Statement = doc.Statement.concat(getStatementsForEffect.call(this, "Allow", this.allowMethods));
            doc.Statement = doc.Statement.concat(getStatementsForEffect.call(this, "Deny", this.denyMethods));

            policy.policyDocument = doc;

            return policy;
        }
    };

})();