# SendTextRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID to send from | 
**To** | **string** | Recipient (phone number or platform ID) | 
**Text** | **string** | Message text | 
**ReplyTo** | Pointer to **string** | Message ID to reply to | [optional] 

## Methods

### NewSendTextRequest

`func NewSendTextRequest(instanceId string, to string, text string, ) *SendTextRequest`

NewSendTextRequest instantiates a new SendTextRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendTextRequestWithDefaults

`func NewSendTextRequestWithDefaults() *SendTextRequest`

NewSendTextRequestWithDefaults instantiates a new SendTextRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendTextRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendTextRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendTextRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendTextRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendTextRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendTextRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetText

`func (o *SendTextRequest) GetText() string`

GetText returns the Text field if non-nil, zero value otherwise.

### GetTextOk

`func (o *SendTextRequest) GetTextOk() (*string, bool)`

GetTextOk returns a tuple with the Text field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetText

`func (o *SendTextRequest) SetText(v string)`

SetText sets Text field to given value.


### GetReplyTo

`func (o *SendTextRequest) GetReplyTo() string`

GetReplyTo returns the ReplyTo field if non-nil, zero value otherwise.

### GetReplyToOk

`func (o *SendTextRequest) GetReplyToOk() (*string, bool)`

GetReplyToOk returns a tuple with the ReplyTo field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReplyTo

`func (o *SendTextRequest) SetReplyTo(v string)`

SetReplyTo sets ReplyTo field to given value.

### HasReplyTo

`func (o *SendTextRequest) HasReplyTo() bool`

HasReplyTo returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


