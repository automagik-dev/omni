# SendTextMessageRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID to send from | 
**To** | **string** | Recipient (phone number or platform ID) | 
**Text** | **string** | Message text | 
**ReplyTo** | Pointer to **string** | Message ID to reply to | [optional] 

## Methods

### NewSendTextMessageRequest

`func NewSendTextMessageRequest(instanceId string, to string, text string, ) *SendTextMessageRequest`

NewSendTextMessageRequest instantiates a new SendTextMessageRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendTextMessageRequestWithDefaults

`func NewSendTextMessageRequestWithDefaults() *SendTextMessageRequest`

NewSendTextMessageRequestWithDefaults instantiates a new SendTextMessageRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendTextMessageRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendTextMessageRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendTextMessageRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendTextMessageRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendTextMessageRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendTextMessageRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetText

`func (o *SendTextMessageRequest) GetText() string`

GetText returns the Text field if non-nil, zero value otherwise.

### GetTextOk

`func (o *SendTextMessageRequest) GetTextOk() (*string, bool)`

GetTextOk returns a tuple with the Text field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetText

`func (o *SendTextMessageRequest) SetText(v string)`

SetText sets Text field to given value.


### GetReplyTo

`func (o *SendTextMessageRequest) GetReplyTo() string`

GetReplyTo returns the ReplyTo field if non-nil, zero value otherwise.

### GetReplyToOk

`func (o *SendTextMessageRequest) GetReplyToOk() (*string, bool)`

GetReplyToOk returns a tuple with the ReplyTo field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReplyTo

`func (o *SendTextMessageRequest) SetReplyTo(v string)`

SetReplyTo sets ReplyTo field to given value.

### HasReplyTo

`func (o *SendTextMessageRequest) HasReplyTo() bool`

HasReplyTo returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


