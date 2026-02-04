# ListPayloadConfigs200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**EventType** | **string** | Event type pattern | 
**StoreWebhookRaw** | **bool** | Store webhook raw | 
**StoreAgentRequest** | **bool** | Store agent request | 
**StoreAgentResponse** | **bool** | Store agent response | 
**StoreChannelSend** | **bool** | Store channel send | 
**StoreError** | **bool** | Store errors | 
**RetentionDays** | **int32** | Retention in days | 

## Methods

### NewListPayloadConfigs200ResponseItemsInner

`func NewListPayloadConfigs200ResponseItemsInner(eventType string, storeWebhookRaw bool, storeAgentRequest bool, storeAgentResponse bool, storeChannelSend bool, storeError bool, retentionDays int32, ) *ListPayloadConfigs200ResponseItemsInner`

NewListPayloadConfigs200ResponseItemsInner instantiates a new ListPayloadConfigs200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListPayloadConfigs200ResponseItemsInnerWithDefaults

`func NewListPayloadConfigs200ResponseItemsInnerWithDefaults() *ListPayloadConfigs200ResponseItemsInner`

NewListPayloadConfigs200ResponseItemsInnerWithDefaults instantiates a new ListPayloadConfigs200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetEventType

`func (o *ListPayloadConfigs200ResponseItemsInner) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *ListPayloadConfigs200ResponseItemsInner) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetStoreWebhookRaw

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreWebhookRaw() bool`

GetStoreWebhookRaw returns the StoreWebhookRaw field if non-nil, zero value otherwise.

### GetStoreWebhookRawOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreWebhookRawOk() (*bool, bool)`

GetStoreWebhookRawOk returns a tuple with the StoreWebhookRaw field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreWebhookRaw

`func (o *ListPayloadConfigs200ResponseItemsInner) SetStoreWebhookRaw(v bool)`

SetStoreWebhookRaw sets StoreWebhookRaw field to given value.


### GetStoreAgentRequest

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreAgentRequest() bool`

GetStoreAgentRequest returns the StoreAgentRequest field if non-nil, zero value otherwise.

### GetStoreAgentRequestOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreAgentRequestOk() (*bool, bool)`

GetStoreAgentRequestOk returns a tuple with the StoreAgentRequest field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreAgentRequest

`func (o *ListPayloadConfigs200ResponseItemsInner) SetStoreAgentRequest(v bool)`

SetStoreAgentRequest sets StoreAgentRequest field to given value.


### GetStoreAgentResponse

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreAgentResponse() bool`

GetStoreAgentResponse returns the StoreAgentResponse field if non-nil, zero value otherwise.

### GetStoreAgentResponseOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreAgentResponseOk() (*bool, bool)`

GetStoreAgentResponseOk returns a tuple with the StoreAgentResponse field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreAgentResponse

`func (o *ListPayloadConfigs200ResponseItemsInner) SetStoreAgentResponse(v bool)`

SetStoreAgentResponse sets StoreAgentResponse field to given value.


### GetStoreChannelSend

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreChannelSend() bool`

GetStoreChannelSend returns the StoreChannelSend field if non-nil, zero value otherwise.

### GetStoreChannelSendOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreChannelSendOk() (*bool, bool)`

GetStoreChannelSendOk returns a tuple with the StoreChannelSend field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreChannelSend

`func (o *ListPayloadConfigs200ResponseItemsInner) SetStoreChannelSend(v bool)`

SetStoreChannelSend sets StoreChannelSend field to given value.


### GetStoreError

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreError() bool`

GetStoreError returns the StoreError field if non-nil, zero value otherwise.

### GetStoreErrorOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetStoreErrorOk() (*bool, bool)`

GetStoreErrorOk returns a tuple with the StoreError field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreError

`func (o *ListPayloadConfigs200ResponseItemsInner) SetStoreError(v bool)`

SetStoreError sets StoreError field to given value.


### GetRetentionDays

`func (o *ListPayloadConfigs200ResponseItemsInner) GetRetentionDays() int32`

GetRetentionDays returns the RetentionDays field if non-nil, zero value otherwise.

### GetRetentionDaysOk

`func (o *ListPayloadConfigs200ResponseItemsInner) GetRetentionDaysOk() (*int32, bool)`

GetRetentionDaysOk returns a tuple with the RetentionDays field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetentionDays

`func (o *ListPayloadConfigs200ResponseItemsInner) SetRetentionDays(v int32)`

SetRetentionDays sets RetentionDays field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


