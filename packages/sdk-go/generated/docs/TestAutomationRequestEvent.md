# TestAutomationRequestEvent

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Type** | **string** | Event type | 
**Payload** | **map[string]interface{}** | Event payload | 

## Methods

### NewTestAutomationRequestEvent

`func NewTestAutomationRequestEvent(type_ string, payload map[string]interface{}, ) *TestAutomationRequestEvent`

NewTestAutomationRequestEvent instantiates a new TestAutomationRequestEvent object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTestAutomationRequestEventWithDefaults

`func NewTestAutomationRequestEventWithDefaults() *TestAutomationRequestEvent`

NewTestAutomationRequestEventWithDefaults instantiates a new TestAutomationRequestEvent object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetType

`func (o *TestAutomationRequestEvent) GetType() string`

GetType returns the Type field if non-nil, zero value otherwise.

### GetTypeOk

`func (o *TestAutomationRequestEvent) GetTypeOk() (*string, bool)`

GetTypeOk returns a tuple with the Type field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetType

`func (o *TestAutomationRequestEvent) SetType(v string)`

SetType sets Type field to given value.


### GetPayload

`func (o *TestAutomationRequestEvent) GetPayload() map[string]interface{}`

GetPayload returns the Payload field if non-nil, zero value otherwise.

### GetPayloadOk

`func (o *TestAutomationRequestEvent) GetPayloadOk() (*map[string]interface{}, bool)`

GetPayloadOk returns a tuple with the Payload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPayload

`func (o *TestAutomationRequestEvent) SetPayload(v map[string]interface{})`

SetPayload sets Payload field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


