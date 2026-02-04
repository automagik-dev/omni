# omni_generated.MessagesApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**mark_message_read**](MessagesApi.md#mark_message_read) | **POST** /messages/{id}/read | Mark message as read
[**mark_messages_read**](MessagesApi.md#mark_messages_read) | **POST** /messages/read | Mark multiple messages as read
[**send_contact**](MessagesApi.md#send_contact) | **POST** /messages/contact | Send contact card
[**send_location**](MessagesApi.md#send_location) | **POST** /messages/location | Send location
[**send_media_message**](MessagesApi.md#send_media_message) | **POST** /messages/media | Send media message
[**send_presence**](MessagesApi.md#send_presence) | **POST** /messages/send/presence | Send presence indicator
[**send_reaction**](MessagesApi.md#send_reaction) | **POST** /messages/reaction | Send reaction
[**send_sticker**](MessagesApi.md#send_sticker) | **POST** /messages/sticker | Send sticker
[**send_text_message**](MessagesApi.md#send_text_message) | **POST** /messages | Send text message


# **mark_message_read**
> MarkMessageRead200Response mark_message_read(id, mark_message_read_request=mark_message_read_request)

Mark message as read

Send read receipt for a specific message. WhatsApp only.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.mark_message_read200_response import MarkMessageRead200Response
from omni_generated.models.mark_message_read_request import MarkMessageReadRequest
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
    api_instance = omni_generated.MessagesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    mark_message_read_request = omni_generated.MarkMessageReadRequest() # MarkMessageReadRequest |  (optional)

    try:
        # Mark message as read
        api_response = api_instance.mark_message_read(id, mark_message_read_request=mark_message_read_request)
        print("The response of MessagesApi->mark_message_read:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->mark_message_read: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **mark_message_read_request** | [**MarkMessageReadRequest**](MarkMessageReadRequest.md)|  | [optional] 

### Return type

[**MarkMessageRead200Response**](MarkMessageRead200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Message marked as read |  -  |
**400** | Validation error or capability not supported |  -  |
**404** | Message not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **mark_messages_read**
> MarkMessageRead200Response mark_messages_read(mark_messages_read_request=mark_messages_read_request)

Mark multiple messages as read

Send read receipts for multiple messages in a single chat. WhatsApp only.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.mark_message_read200_response import MarkMessageRead200Response
from omni_generated.models.mark_messages_read_request import MarkMessagesReadRequest
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
    api_instance = omni_generated.MessagesApi(api_client)
    mark_messages_read_request = omni_generated.MarkMessagesReadRequest() # MarkMessagesReadRequest |  (optional)

    try:
        # Mark multiple messages as read
        api_response = api_instance.mark_messages_read(mark_messages_read_request=mark_messages_read_request)
        print("The response of MessagesApi->mark_messages_read:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->mark_messages_read: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **mark_messages_read_request** | [**MarkMessagesReadRequest**](MarkMessagesReadRequest.md)|  | [optional] 

### Return type

[**MarkMessageRead200Response**](MarkMessageRead200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Messages marked as read |  -  |
**400** | Validation error or capability not supported |  -  |
**404** | Instance or chat not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_contact**
> SendTextMessage201Response send_contact(send_contact_request=send_contact_request)

Send contact card

Send a contact card through a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_contact_request import SendContactRequest
from omni_generated.models.send_text_message201_response import SendTextMessage201Response
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_contact_request = omni_generated.SendContactRequest() # SendContactRequest |  (optional)

    try:
        # Send contact card
        api_response = api_instance.send_contact(send_contact_request=send_contact_request)
        print("The response of MessagesApi->send_contact:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_contact: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_contact_request** | [**SendContactRequest**](SendContactRequest.md)|  | [optional] 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Contact sent |  -  |
**400** | Validation error |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_location**
> SendTextMessage201Response send_location(send_location_request=send_location_request)

Send location

Send a location through a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_location_request import SendLocationRequest
from omni_generated.models.send_text_message201_response import SendTextMessage201Response
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_location_request = omni_generated.SendLocationRequest() # SendLocationRequest |  (optional)

    try:
        # Send location
        api_response = api_instance.send_location(send_location_request=send_location_request)
        print("The response of MessagesApi->send_location:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_location: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_location_request** | [**SendLocationRequest**](SendLocationRequest.md)|  | [optional] 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Location sent |  -  |
**400** | Validation error |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_media_message**
> SendTextMessage201Response send_media_message(send_media_message_request=send_media_message_request)

Send media message

Send an image, audio, video, or document through a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_media_message_request import SendMediaMessageRequest
from omni_generated.models.send_text_message201_response import SendTextMessage201Response
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_media_message_request = omni_generated.SendMediaMessageRequest() # SendMediaMessageRequest |  (optional)

    try:
        # Send media message
        api_response = api_instance.send_media_message(send_media_message_request=send_media_message_request)
        print("The response of MessagesApi->send_media_message:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_media_message: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_media_message_request** | [**SendMediaMessageRequest**](SendMediaMessageRequest.md)|  | [optional] 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Media sent |  -  |
**400** | Validation error |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_presence**
> SendPresence200Response send_presence(send_presence_request=send_presence_request)

Send presence indicator

Send typing/recording indicator in a chat. Auto-pauses after duration. WhatsApp supports typing, recording, paused. Discord only supports typing.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_presence200_response import SendPresence200Response
from omni_generated.models.send_presence_request import SendPresenceRequest
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_presence_request = omni_generated.SendPresenceRequest() # SendPresenceRequest |  (optional)

    try:
        # Send presence indicator
        api_response = api_instance.send_presence(send_presence_request=send_presence_request)
        print("The response of MessagesApi->send_presence:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_presence: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_presence_request** | [**SendPresenceRequest**](SendPresenceRequest.md)|  | [optional] 

### Return type

[**SendPresence200Response**](SendPresence200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Presence sent |  -  |
**400** | Validation error or capability not supported |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_reaction**
> DeleteInstance200Response send_reaction(send_reaction_request=send_reaction_request)

Send reaction

React to a message with an emoji.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.delete_instance200_response import DeleteInstance200Response
from omni_generated.models.send_reaction_request import SendReactionRequest
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_reaction_request = omni_generated.SendReactionRequest() # SendReactionRequest |  (optional)

    try:
        # Send reaction
        api_response = api_instance.send_reaction(send_reaction_request=send_reaction_request)
        print("The response of MessagesApi->send_reaction:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_reaction: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_reaction_request** | [**SendReactionRequest**](SendReactionRequest.md)|  | [optional] 

### Return type

[**DeleteInstance200Response**](DeleteInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Reaction sent |  -  |
**400** | Validation error |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_sticker**
> SendTextMessage201Response send_sticker(send_sticker_request=send_sticker_request)

Send sticker

Send a sticker through a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_sticker_request import SendStickerRequest
from omni_generated.models.send_text_message201_response import SendTextMessage201Response
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_sticker_request = omni_generated.SendStickerRequest() # SendStickerRequest |  (optional)

    try:
        # Send sticker
        api_response = api_instance.send_sticker(send_sticker_request=send_sticker_request)
        print("The response of MessagesApi->send_sticker:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_sticker: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_sticker_request** | [**SendStickerRequest**](SendStickerRequest.md)|  | [optional] 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Sticker sent |  -  |
**400** | Validation error |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **send_text_message**
> SendTextMessage201Response send_text_message(send_text_message_request=send_text_message_request)

Send text message

Send a text message through a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_text_message201_response import SendTextMessage201Response
from omni_generated.models.send_text_message_request import SendTextMessageRequest
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
    api_instance = omni_generated.MessagesApi(api_client)
    send_text_message_request = omni_generated.SendTextMessageRequest() # SendTextMessageRequest |  (optional)

    try:
        # Send text message
        api_response = api_instance.send_text_message(send_text_message_request=send_text_message_request)
        print("The response of MessagesApi->send_text_message:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MessagesApi->send_text_message: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_text_message_request** | [**SendTextMessageRequest**](SendTextMessageRequest.md)|  | [optional] 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Message sent |  -  |
**400** | Validation error |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

