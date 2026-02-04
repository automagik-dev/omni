# SendReactionRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**To** | **string** | Chat ID | 
**MessageId** | **string** | Message ID to react to | 
**Emoji** | **string** | Emoji to react with | 

## Methods

### NewSendReactionRequest

`func NewSendReactionRequest(instanceId string, to string, messageId string, emoji string, ) *SendReactionRequest`

NewSendReactionRequest instantiates a new SendReactionRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendReactionRequestWithDefaults

`func NewSendReactionRequestWithDefaults() *SendReactionRequest`

NewSendReactionRequestWithDefaults instantiates a new SendReactionRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendReactionRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendReactionRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendReactionRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendReactionRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendReactionRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendReactionRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetMessageId

`func (o *SendReactionRequest) GetMessageId() string`

GetMessageId returns the MessageId field if non-nil, zero value otherwise.

### GetMessageIdOk

`func (o *SendReactionRequest) GetMessageIdOk() (*string, bool)`

GetMessageIdOk returns a tuple with the MessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageId

`func (o *SendReactionRequest) SetMessageId(v string)`

SetMessageId sets MessageId field to given value.


### GetEmoji

`func (o *SendReactionRequest) GetEmoji() string`

GetEmoji returns the Emoji field if non-nil, zero value otherwise.

### GetEmojiOk

`func (o *SendReactionRequest) GetEmojiOk() (*string, bool)`

GetEmojiOk returns a tuple with the Emoji field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmoji

`func (o *SendReactionRequest) SetEmoji(v string)`

SetEmoji sets Emoji field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


