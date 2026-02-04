# TriggerEventRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**EventType** | **string** | Event type (must start with custom.) | 
**Payload** | **map[string]interface{}** | Event payload | 
**CorrelationId** | Pointer to **string** | Correlation ID | [optional] 
**InstanceId** | Pointer to **string** | Instance ID for context | [optional] 

## Methods

### NewTriggerEventRequest

`func NewTriggerEventRequest(eventType string, payload map[string]interface{}, ) *TriggerEventRequest`

NewTriggerEventRequest instantiates a new TriggerEventRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTriggerEventRequestWithDefaults

`func NewTriggerEventRequestWithDefaults() *TriggerEventRequest`

NewTriggerEventRequestWithDefaults instantiates a new TriggerEventRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetEventType

`func (o *TriggerEventRequest) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *TriggerEventRequest) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *TriggerEventRequest) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetPayload

`func (o *TriggerEventRequest) GetPayload() map[string]interface{}`

GetPayload returns the Payload field if non-nil, zero value otherwise.

### GetPayloadOk

`func (o *TriggerEventRequest) GetPayloadOk() (*map[string]interface{}, bool)`

GetPayloadOk returns a tuple with the Payload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPayload

`func (o *TriggerEventRequest) SetPayload(v map[string]interface{})`

SetPayload sets Payload field to given value.


### GetCorrelationId

`func (o *TriggerEventRequest) GetCorrelationId() string`

GetCorrelationId returns the CorrelationId field if non-nil, zero value otherwise.

### GetCorrelationIdOk

`func (o *TriggerEventRequest) GetCorrelationIdOk() (*string, bool)`

GetCorrelationIdOk returns a tuple with the CorrelationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCorrelationId

`func (o *TriggerEventRequest) SetCorrelationId(v string)`

SetCorrelationId sets CorrelationId field to given value.

### HasCorrelationId

`func (o *TriggerEventRequest) HasCorrelationId() bool`

HasCorrelationId returns a boolean if a field has been set.

### GetInstanceId

`func (o *TriggerEventRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *TriggerEventRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *TriggerEventRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *TriggerEventRequest) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


