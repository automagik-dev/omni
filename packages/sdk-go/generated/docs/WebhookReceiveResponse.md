# WebhookReceiveResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**EventId** | **string** | Created event ID | 
**Source** | **string** | Webhook source name | 
**EventType** | **string** | Event type | 

## Methods

### NewWebhookReceiveResponse

`func NewWebhookReceiveResponse(eventId string, source string, eventType string, ) *WebhookReceiveResponse`

NewWebhookReceiveResponse instantiates a new WebhookReceiveResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewWebhookReceiveResponseWithDefaults

`func NewWebhookReceiveResponseWithDefaults() *WebhookReceiveResponse`

NewWebhookReceiveResponseWithDefaults instantiates a new WebhookReceiveResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetEventId

`func (o *WebhookReceiveResponse) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *WebhookReceiveResponse) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *WebhookReceiveResponse) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetSource

`func (o *WebhookReceiveResponse) GetSource() string`

GetSource returns the Source field if non-nil, zero value otherwise.

### GetSourceOk

`func (o *WebhookReceiveResponse) GetSourceOk() (*string, bool)`

GetSourceOk returns a tuple with the Source field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSource

`func (o *WebhookReceiveResponse) SetSource(v string)`

SetSource sets Source field to given value.


### GetEventType

`func (o *WebhookReceiveResponse) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *WebhookReceiveResponse) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *WebhookReceiveResponse) SetEventType(v string)`

SetEventType sets EventType field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


