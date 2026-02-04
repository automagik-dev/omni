# SendPresence200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**ChatId** | **string** | Chat ID where presence was sent | 
**Type** | **string** | Presence type sent | 
**Duration** | **float32** | Duration in ms | 

## Methods

### NewSendPresence200ResponseData

`func NewSendPresence200ResponseData(instanceId string, chatId string, type_ string, duration float32, ) *SendPresence200ResponseData`

NewSendPresence200ResponseData instantiates a new SendPresence200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendPresence200ResponseDataWithDefaults

`func NewSendPresence200ResponseDataWithDefaults() *SendPresence200ResponseData`

NewSendPresence200ResponseDataWithDefaults instantiates a new SendPresence200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendPresence200ResponseData) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendPresence200ResponseData) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendPresence200ResponseData) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetChatId

`func (o *SendPresence200ResponseData) GetChatId() string`

GetChatId returns the ChatId field if non-nil, zero value otherwise.

### GetChatIdOk

`func (o *SendPresence200ResponseData) GetChatIdOk() (*string, bool)`

GetChatIdOk returns a tuple with the ChatId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChatId

`func (o *SendPresence200ResponseData) SetChatId(v string)`

SetChatId sets ChatId field to given value.


### GetType

`func (o *SendPresence200ResponseData) GetType() string`

GetType returns the Type field if non-nil, zero value otherwise.

### GetTypeOk

`func (o *SendPresence200ResponseData) GetTypeOk() (*string, bool)`

GetTypeOk returns a tuple with the Type field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetType

`func (o *SendPresence200ResponseData) SetType(v string)`

SetType sets Type field to given value.


### GetDuration

`func (o *SendPresence200ResponseData) GetDuration() float32`

GetDuration returns the Duration field if non-nil, zero value otherwise.

### GetDurationOk

`func (o *SendPresence200ResponseData) GetDurationOk() (*float32, bool)`

GetDurationOk returns a tuple with the Duration field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDuration

`func (o *SendPresence200ResponseData) SetDuration(v float32)`

SetDuration sets Duration field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


