# UpdatePayloadConfigRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**StoreWebhookRaw** | Pointer to **bool** | Store webhook raw | [optional] 
**StoreAgentRequest** | Pointer to **bool** | Store agent request | [optional] 
**StoreAgentResponse** | Pointer to **bool** | Store agent response | [optional] 
**StoreChannelSend** | Pointer to **bool** | Store channel send | [optional] 
**StoreError** | Pointer to **bool** | Store errors | [optional] 
**RetentionDays** | Pointer to **int32** | Retention in days | [optional] 

## Methods

### NewUpdatePayloadConfigRequest

`func NewUpdatePayloadConfigRequest() *UpdatePayloadConfigRequest`

NewUpdatePayloadConfigRequest instantiates a new UpdatePayloadConfigRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdatePayloadConfigRequestWithDefaults

`func NewUpdatePayloadConfigRequestWithDefaults() *UpdatePayloadConfigRequest`

NewUpdatePayloadConfigRequestWithDefaults instantiates a new UpdatePayloadConfigRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStoreWebhookRaw

`func (o *UpdatePayloadConfigRequest) GetStoreWebhookRaw() bool`

GetStoreWebhookRaw returns the StoreWebhookRaw field if non-nil, zero value otherwise.

### GetStoreWebhookRawOk

`func (o *UpdatePayloadConfigRequest) GetStoreWebhookRawOk() (*bool, bool)`

GetStoreWebhookRawOk returns a tuple with the StoreWebhookRaw field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreWebhookRaw

`func (o *UpdatePayloadConfigRequest) SetStoreWebhookRaw(v bool)`

SetStoreWebhookRaw sets StoreWebhookRaw field to given value.

### HasStoreWebhookRaw

`func (o *UpdatePayloadConfigRequest) HasStoreWebhookRaw() bool`

HasStoreWebhookRaw returns a boolean if a field has been set.

### GetStoreAgentRequest

`func (o *UpdatePayloadConfigRequest) GetStoreAgentRequest() bool`

GetStoreAgentRequest returns the StoreAgentRequest field if non-nil, zero value otherwise.

### GetStoreAgentRequestOk

`func (o *UpdatePayloadConfigRequest) GetStoreAgentRequestOk() (*bool, bool)`

GetStoreAgentRequestOk returns a tuple with the StoreAgentRequest field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreAgentRequest

`func (o *UpdatePayloadConfigRequest) SetStoreAgentRequest(v bool)`

SetStoreAgentRequest sets StoreAgentRequest field to given value.

### HasStoreAgentRequest

`func (o *UpdatePayloadConfigRequest) HasStoreAgentRequest() bool`

HasStoreAgentRequest returns a boolean if a field has been set.

### GetStoreAgentResponse

`func (o *UpdatePayloadConfigRequest) GetStoreAgentResponse() bool`

GetStoreAgentResponse returns the StoreAgentResponse field if non-nil, zero value otherwise.

### GetStoreAgentResponseOk

`func (o *UpdatePayloadConfigRequest) GetStoreAgentResponseOk() (*bool, bool)`

GetStoreAgentResponseOk returns a tuple with the StoreAgentResponse field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreAgentResponse

`func (o *UpdatePayloadConfigRequest) SetStoreAgentResponse(v bool)`

SetStoreAgentResponse sets StoreAgentResponse field to given value.

### HasStoreAgentResponse

`func (o *UpdatePayloadConfigRequest) HasStoreAgentResponse() bool`

HasStoreAgentResponse returns a boolean if a field has been set.

### GetStoreChannelSend

`func (o *UpdatePayloadConfigRequest) GetStoreChannelSend() bool`

GetStoreChannelSend returns the StoreChannelSend field if non-nil, zero value otherwise.

### GetStoreChannelSendOk

`func (o *UpdatePayloadConfigRequest) GetStoreChannelSendOk() (*bool, bool)`

GetStoreChannelSendOk returns a tuple with the StoreChannelSend field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreChannelSend

`func (o *UpdatePayloadConfigRequest) SetStoreChannelSend(v bool)`

SetStoreChannelSend sets StoreChannelSend field to given value.

### HasStoreChannelSend

`func (o *UpdatePayloadConfigRequest) HasStoreChannelSend() bool`

HasStoreChannelSend returns a boolean if a field has been set.

### GetStoreError

`func (o *UpdatePayloadConfigRequest) GetStoreError() bool`

GetStoreError returns the StoreError field if non-nil, zero value otherwise.

### GetStoreErrorOk

`func (o *UpdatePayloadConfigRequest) GetStoreErrorOk() (*bool, bool)`

GetStoreErrorOk returns a tuple with the StoreError field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStoreError

`func (o *UpdatePayloadConfigRequest) SetStoreError(v bool)`

SetStoreError sets StoreError field to given value.

### HasStoreError

`func (o *UpdatePayloadConfigRequest) HasStoreError() bool`

HasStoreError returns a boolean if a field has been set.

### GetRetentionDays

`func (o *UpdatePayloadConfigRequest) GetRetentionDays() int32`

GetRetentionDays returns the RetentionDays field if non-nil, zero value otherwise.

### GetRetentionDaysOk

`func (o *UpdatePayloadConfigRequest) GetRetentionDaysOk() (*int32, bool)`

GetRetentionDaysOk returns a tuple with the RetentionDays field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetentionDays

`func (o *UpdatePayloadConfigRequest) SetRetentionDays(v int32)`

SetRetentionDays sets RetentionDays field to given value.

### HasRetentionDays

`func (o *UpdatePayloadConfigRequest) HasRetentionDays() bool`

HasRetentionDays returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


