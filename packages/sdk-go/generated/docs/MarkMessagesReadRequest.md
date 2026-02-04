# MarkMessagesReadRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**ChatId** | **string** | Chat ID containing the messages | 
**MessageIds** | **[]string** | Message IDs to mark as read | 

## Methods

### NewMarkMessagesReadRequest

`func NewMarkMessagesReadRequest(instanceId string, chatId string, messageIds []string, ) *MarkMessagesReadRequest`

NewMarkMessagesReadRequest instantiates a new MarkMessagesReadRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMarkMessagesReadRequestWithDefaults

`func NewMarkMessagesReadRequestWithDefaults() *MarkMessagesReadRequest`

NewMarkMessagesReadRequestWithDefaults instantiates a new MarkMessagesReadRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *MarkMessagesReadRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *MarkMessagesReadRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *MarkMessagesReadRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetChatId

`func (o *MarkMessagesReadRequest) GetChatId() string`

GetChatId returns the ChatId field if non-nil, zero value otherwise.

### GetChatIdOk

`func (o *MarkMessagesReadRequest) GetChatIdOk() (*string, bool)`

GetChatIdOk returns a tuple with the ChatId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChatId

`func (o *MarkMessagesReadRequest) SetChatId(v string)`

SetChatId sets ChatId field to given value.


### GetMessageIds

`func (o *MarkMessagesReadRequest) GetMessageIds() []string`

GetMessageIds returns the MessageIds field if non-nil, zero value otherwise.

### GetMessageIdsOk

`func (o *MarkMessagesReadRequest) GetMessageIdsOk() (*[]string, bool)`

GetMessageIdsOk returns a tuple with the MessageIds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageIds

`func (o *MarkMessagesReadRequest) SetMessageIds(v []string)`

SetMessageIds sets MessageIds field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


