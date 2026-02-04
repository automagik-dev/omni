# omni_generated.EventsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**cancel_replay_session**](EventsApi.md#cancel_replay_session) | **DELETE** /event-ops/replay/{id} | Cancel replay session
[**get_event**](EventsApi.md#get_event) | **GET** /events/{id} | Get event by ID
[**get_event_analytics**](EventsApi.md#get_event_analytics) | **GET** /events/analytics | Get event analytics
[**get_event_metrics**](EventsApi.md#get_event_metrics) | **GET** /event-ops/metrics | Get event metrics
[**get_events_by_sender**](EventsApi.md#get_events_by_sender) | **GET** /events/by-sender/{senderId} | Get events by sender
[**get_person_timeline**](EventsApi.md#get_person_timeline) | **GET** /events/timeline/{personId} | Get person timeline
[**get_replay_session**](EventsApi.md#get_replay_session) | **GET** /event-ops/replay/{id} | Get replay session
[**list_events**](EventsApi.md#list_events) | **GET** /events | List events
[**list_replay_sessions**](EventsApi.md#list_replay_sessions) | **GET** /event-ops/replay | List replay sessions
[**run_scheduled_ops**](EventsApi.md#run_scheduled_ops) | **POST** /event-ops/scheduled | Run scheduled operations
[**search_events**](EventsApi.md#search_events) | **POST** /events/search | Advanced event search
[**start_event_replay**](EventsApi.md#start_event_replay) | **POST** /event-ops/replay | Start replay session


# **cancel_replay_session**
> DeleteInstance200Response cancel_replay_session(id)

Cancel replay session

Cancel a running replay session.

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
    api_instance = omni_generated.EventsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Cancel replay session
        api_response = api_instance.cancel_replay_session(id)
        print("The response of EventsApi->cancel_replay_session:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->cancel_replay_session: %s\n" % e)
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
**200** | Cancelled |  -  |
**400** | Not running |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_event**
> GetEvent200Response get_event(id)

Get event by ID

Get details of a specific event.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_event200_response import GetEvent200Response
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
    api_instance = omni_generated.EventsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get event by ID
        api_response = api_instance.get_event(id)
        print("The response of EventsApi->get_event:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->get_event: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetEvent200Response**](GetEvent200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Event details |  -  |
**404** | Event not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_event_analytics**
> GetEventAnalytics200Response get_event_analytics(since=since, until=until, instance_id=instance_id, all_time=all_time)

Get event analytics

Get analytics summary for events.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_event_analytics200_response import GetEventAnalytics200Response
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
    api_instance = omni_generated.EventsApi(api_client)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    until = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    instance_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    all_time = True # bool |  (optional)

    try:
        # Get event analytics
        api_response = api_instance.get_event_analytics(since=since, until=until, instance_id=instance_id, all_time=all_time)
        print("The response of EventsApi->get_event_analytics:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->get_event_analytics: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **since** | **datetime**|  | [optional] 
 **until** | **datetime**|  | [optional] 
 **instance_id** | **UUID**|  | [optional] 
 **all_time** | **bool**|  | [optional] 

### Return type

[**GetEventAnalytics200Response**](GetEventAnalytics200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Analytics data |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_event_metrics**
> GetEventMetrics200Response get_event_metrics()

Get event metrics

Get event processing metrics.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_event_metrics200_response import GetEventMetrics200Response
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
    api_instance = omni_generated.EventsApi(api_client)

    try:
        # Get event metrics
        api_response = api_instance.get_event_metrics()
        print("The response of EventsApi->get_event_metrics:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->get_event_metrics: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetEventMetrics200Response**](GetEventMetrics200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Metrics |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_events_by_sender**
> GetEventsBySender200Response get_events_by_sender(sender_id, instance_id=instance_id, limit=limit)

Get events by sender

Get events from a specific sender.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_events_by_sender200_response import GetEventsBySender200Response
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
    api_instance = omni_generated.EventsApi(api_client)
    sender_id = 'sender_id_example' # str | 
    instance_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    limit = 50 # int |  (optional) (default to 50)

    try:
        # Get events by sender
        api_response = api_instance.get_events_by_sender(sender_id, instance_id=instance_id, limit=limit)
        print("The response of EventsApi->get_events_by_sender:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->get_events_by_sender: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sender_id** | **str**|  | 
 **instance_id** | **UUID**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]

### Return type

[**GetEventsBySender200Response**](GetEventsBySender200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Events from sender |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_person_timeline**
> GetPersonTimeline200Response get_person_timeline(person_id, channels=channels, since=since, until=until, limit=limit, cursor=cursor)

Get person timeline

Get cross-channel timeline for a person.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_person_timeline200_response import GetPersonTimeline200Response
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
    api_instance = omni_generated.EventsApi(api_client)
    person_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    channels = 'channels_example' # str |  (optional)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    until = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # Get person timeline
        api_response = api_instance.get_person_timeline(person_id, channels=channels, since=since, until=until, limit=limit, cursor=cursor)
        print("The response of EventsApi->get_person_timeline:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->get_person_timeline: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **person_id** | **UUID**|  | 
 **channels** | **str**|  | [optional] 
 **since** | **datetime**|  | [optional] 
 **until** | **datetime**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 

### Return type

[**GetPersonTimeline200Response**](GetPersonTimeline200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Timeline events |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_replay_session**
> StartEventReplay202Response get_replay_session(id)

Get replay session

Get status of a replay session.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.start_event_replay202_response import StartEventReplay202Response
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
    api_instance = omni_generated.EventsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get replay session
        api_response = api_instance.get_replay_session(id)
        print("The response of EventsApi->get_replay_session:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->get_replay_session: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**StartEventReplay202Response**](StartEventReplay202Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Session status |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_events**
> ListEvents200Response list_events(channel=channel, instance_id=instance_id, person_id=person_id, event_type=event_type, content_type=content_type, direction=direction, since=since, until=until, search=search, limit=limit, cursor=cursor)

List events

Get a paginated list of message events with optional filtering.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_events200_response import ListEvents200Response
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
    api_instance = omni_generated.EventsApi(api_client)
    channel = 'channel_example' # str |  (optional)
    instance_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    person_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    event_type = 'event_type_example' # str |  (optional)
    content_type = 'content_type_example' # str |  (optional)
    direction = 'direction_example' # str |  (optional)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    until = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    search = 'search_example' # str |  (optional)
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # List events
        api_response = api_instance.list_events(channel=channel, instance_id=instance_id, person_id=person_id, event_type=event_type, content_type=content_type, direction=direction, since=since, until=until, search=search, limit=limit, cursor=cursor)
        print("The response of EventsApi->list_events:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->list_events: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **channel** | **str**|  | [optional] 
 **instance_id** | **UUID**|  | [optional] 
 **person_id** | **UUID**|  | [optional] 
 **event_type** | **str**|  | [optional] 
 **content_type** | **str**|  | [optional] 
 **direction** | **str**|  | [optional] 
 **since** | **datetime**|  | [optional] 
 **until** | **datetime**|  | [optional] 
 **search** | **str**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 

### Return type

[**ListEvents200Response**](ListEvents200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of events |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_replay_sessions**
> ListReplaySessions200Response list_replay_sessions()

List replay sessions

List all replay sessions.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_replay_sessions200_response import ListReplaySessions200Response
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
    api_instance = omni_generated.EventsApi(api_client)

    try:
        # List replay sessions
        api_response = api_instance.list_replay_sessions()
        print("The response of EventsApi->list_replay_sessions:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->list_replay_sessions: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ListReplaySessions200Response**](ListReplaySessions200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Sessions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **run_scheduled_ops**
> RunScheduledOps200Response run_scheduled_ops()

Run scheduled operations

Manually trigger scheduled operations.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.run_scheduled_ops200_response import RunScheduledOps200Response
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
    api_instance = omni_generated.EventsApi(api_client)

    try:
        # Run scheduled operations
        api_response = api_instance.run_scheduled_ops()
        print("The response of EventsApi->run_scheduled_ops:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->run_scheduled_ops: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**RunScheduledOps200Response**](RunScheduledOps200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Result |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **search_events**
> SearchEvents200Response search_events(search_events_request=search_events_request)

Advanced event search

Search events with advanced filters and multiple output formats.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.search_events200_response import SearchEvents200Response
from omni_generated.models.search_events_request import SearchEventsRequest
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
    api_instance = omni_generated.EventsApi(api_client)
    search_events_request = omni_generated.SearchEventsRequest() # SearchEventsRequest |  (optional)

    try:
        # Advanced event search
        api_response = api_instance.search_events(search_events_request=search_events_request)
        print("The response of EventsApi->search_events:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->search_events: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **search_events_request** | [**SearchEventsRequest**](SearchEventsRequest.md)|  | [optional] 

### Return type

[**SearchEvents200Response**](SearchEvents200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Search results |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **start_event_replay**
> StartEventReplay202Response start_event_replay(list_replay_sessions200_response_items_inner_options=list_replay_sessions200_response_items_inner_options)

Start replay session

Start an event replay session.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_replay_sessions200_response_items_inner_options import ListReplaySessions200ResponseItemsInnerOptions
from omni_generated.models.start_event_replay202_response import StartEventReplay202Response
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
    api_instance = omni_generated.EventsApi(api_client)
    list_replay_sessions200_response_items_inner_options = omni_generated.ListReplaySessions200ResponseItemsInnerOptions() # ListReplaySessions200ResponseItemsInnerOptions |  (optional)

    try:
        # Start replay session
        api_response = api_instance.start_event_replay(list_replay_sessions200_response_items_inner_options=list_replay_sessions200_response_items_inner_options)
        print("The response of EventsApi->start_event_replay:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EventsApi->start_event_replay: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **list_replay_sessions200_response_items_inner_options** | [**ListReplaySessions200ResponseItemsInnerOptions**](ListReplaySessions200ResponseItemsInnerOptions.md)|  | [optional] 

### Return type

[**StartEventReplay202Response**](StartEventReplay202Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**202** | Replay started |  -  |
**400** | Invalid options |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

