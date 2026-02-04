# ReadReceiptResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**MessageId** | Pointer to **string** | Internal message ID (if single message) | [optional] 
**ExternalMessageId** | Pointer to **string** | External message ID | [optional] 
**ChatId** | Pointer to **string** | Chat ID | [optional] 
**InstanceId** | Pointer to **string** | Instance ID | [optional] 
**MessageCount** | Pointer to **float32** | Number of messages marked (batch only) | [optional] 

## Methods

### NewReadReceiptResponse

`func NewReadReceiptResponse() *ReadReceiptResponse`

NewReadReceiptResponse instantiates a new ReadReceiptResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewReadReceiptResponseWithDefaults

`func NewReadReceiptResponseWithDefaults() *ReadReceiptResponse`

NewReadReceiptResponseWithDefaults instantiates a new ReadReceiptResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetMessageId

`func (o *ReadReceiptResponse) GetMessageId() string`

GetMessageId returns the MessageId field if non-nil, zero value otherwise.

### GetMessageIdOk

`func (o *ReadReceiptResponse) GetMessageIdOk() (*string, bool)`

GetMessageIdOk returns a tuple with the MessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageId

`func (o *ReadReceiptResponse) SetMessageId(v string)`

SetMessageId sets MessageId field to given value.

### HasMessageId

`func (o *ReadReceiptResponse) HasMessageId() bool`

HasMessageId returns a boolean if a field has been set.

### GetExternalMessageId

`func (o *ReadReceiptResponse) GetExternalMessageId() string`

GetExternalMessageId returns the ExternalMessageId field if non-nil, zero value otherwise.

### GetExternalMessageIdOk

`func (o *ReadReceiptResponse) GetExternalMessageIdOk() (*string, bool)`

GetExternalMessageIdOk returns a tuple with the ExternalMessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExternalMessageId

`func (o *ReadReceiptResponse) SetExternalMessageId(v string)`

SetExternalMessageId sets ExternalMessageId field to given value.

### HasExternalMessageId

`func (o *ReadReceiptResponse) HasExternalMessageId() bool`

HasExternalMessageId returns a boolean if a field has been set.

### GetChatId

`func (o *ReadReceiptResponse) GetChatId() string`

GetChatId returns the ChatId field if non-nil, zero value otherwise.

### GetChatIdOk

`func (o *ReadReceiptResponse) GetChatIdOk() (*string, bool)`

GetChatIdOk returns a tuple with the ChatId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChatId

`func (o *ReadReceiptResponse) SetChatId(v string)`

SetChatId sets ChatId field to given value.

### HasChatId

`func (o *ReadReceiptResponse) HasChatId() bool`

HasChatId returns a boolean if a field has been set.

### GetInstanceId

`func (o *ReadReceiptResponse) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *ReadReceiptResponse) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *ReadReceiptResponse) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *ReadReceiptResponse) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### GetMessageCount

`func (o *ReadReceiptResponse) GetMessageCount() float32`

GetMessageCount returns the MessageCount field if non-nil, zero value otherwise.

### GetMessageCountOk

`func (o *ReadReceiptResponse) GetMessageCountOk() (*float32, bool)`

GetMessageCountOk returns a tuple with the MessageCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageCount

`func (o *ReadReceiptResponse) SetMessageCount(v float32)`

SetMessageCount sets MessageCount field to given value.

### HasMessageCount

`func (o *ReadReceiptResponse) HasMessageCount() bool`

HasMessageCount returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


