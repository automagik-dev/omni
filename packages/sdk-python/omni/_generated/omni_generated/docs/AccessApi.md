# omni_generated.AccessApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**check_access**](AccessApi.md#check_access) | **POST** /access/check | Check access
[**create_access_rule**](AccessApi.md#create_access_rule) | **POST** /access/rules | Create access rule
[**delete_access_rule**](AccessApi.md#delete_access_rule) | **DELETE** /access/rules/{id} | Delete access rule
[**get_access_rule**](AccessApi.md#get_access_rule) | **GET** /access/rules/{id} | Get access rule
[**list_access_rules**](AccessApi.md#list_access_rules) | **GET** /access/rules | List access rules
[**update_access_rule**](AccessApi.md#update_access_rule) | **PATCH** /access/rules/{id} | Update access rule


# **check_access**
> CheckAccess200Response check_access(check_access_request=check_access_request)

Check access

Check if access is allowed for a user.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.check_access200_response import CheckAccess200Response
from omni_generated.models.check_access_request import CheckAccessRequest
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.AccessApi(api_client)
    check_access_request = omni_generated.CheckAccessRequest() # CheckAccessRequest |  (optional)

    try:
        # Check access
        api_response = api_instance.check_access(check_access_request=check_access_request)
        print("The response of AccessApi->check_access:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AccessApi->check_access: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **check_access_request** | [**CheckAccessRequest**](CheckAccessRequest.md)|  | [optional] 

### Return type

[**CheckAccess200Response**](CheckAccess200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Access check result |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **create_access_rule**
> CreateAccessRule201Response create_access_rule(create_access_rule_request=create_access_rule_request)

Create access rule

Create a new access rule.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_access_rule201_response import CreateAccessRule201Response
from omni_generated.models.create_access_rule_request import CreateAccessRuleRequest
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.AccessApi(api_client)
    create_access_rule_request = omni_generated.CreateAccessRuleRequest() # CreateAccessRuleRequest |  (optional)

    try:
        # Create access rule
        api_response = api_instance.create_access_rule(create_access_rule_request=create_access_rule_request)
        print("The response of AccessApi->create_access_rule:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AccessApi->create_access_rule: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_access_rule_request** | [**CreateAccessRuleRequest**](CreateAccessRuleRequest.md)|  | [optional] 

### Return type

[**CreateAccessRule201Response**](CreateAccessRule201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Rule created |  -  |
**400** | Validation error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_access_rule**
> DeleteInstance200Response delete_access_rule(id)

Delete access rule

Delete an access rule.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.delete_instance200_response import DeleteInstance200Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.AccessApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Delete access rule
        api_response = api_instance.delete_access_rule(id)
        print("The response of AccessApi->delete_access_rule:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AccessApi->delete_access_rule: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**DeleteInstance200Response**](DeleteInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Rule deleted |  -  |
**404** | Rule not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_access_rule**
> CreateAccessRule201Response get_access_rule(id)

Get access rule

Get details of a specific access rule.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_access_rule201_response import CreateAccessRule201Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.AccessApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get access rule
        api_response = api_instance.get_access_rule(id)
        print("The response of AccessApi->get_access_rule:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AccessApi->get_access_rule: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateAccessRule201Response**](CreateAccessRule201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Rule details |  -  |
**404** | Rule not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_access_rules**
> ListAccessRules200Response list_access_rules(instance_id=instance_id, type=type)

List access rules

Get all access rules with optional filtering.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_access_rules200_response import ListAccessRules200Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.AccessApi(api_client)
    instance_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    type = 'type_example' # str |  (optional)

    try:
        # List access rules
        api_response = api_instance.list_access_rules(instance_id=instance_id, type=type)
        print("The response of AccessApi->list_access_rules:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AccessApi->list_access_rules: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **instance_id** | **UUID**|  | [optional] 
 **type** | **str**|  | [optional] 

### Return type

[**ListAccessRules200Response**](ListAccessRules200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of rules |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_access_rule**
> CreateAccessRule201Response update_access_rule(id, update_access_rule_request=update_access_rule_request)

Update access rule

Update an existing access rule.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_access_rule201_response import CreateAccessRule201Response
from omni_generated.models.update_access_rule_request import UpdateAccessRuleRequest
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.AccessApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    update_access_rule_request = omni_generated.UpdateAccessRuleRequest() # UpdateAccessRuleRequest |  (optional)

    try:
        # Update access rule
        api_response = api_instance.update_access_rule(id, update_access_rule_request=update_access_rule_request)
        print("The response of AccessApi->update_access_rule:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AccessApi->update_access_rule: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **update_access_rule_request** | [**UpdateAccessRuleRequest**](UpdateAccessRuleRequest.md)|  | [optional] 

### Return type

[**CreateAccessRule201Response**](CreateAccessRule201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Rule updated |  -  |
**404** | Rule not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

