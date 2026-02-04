# MessageResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**MessageId** | **string** | Internal message ID | 
**ExternalMessageId** | **string** | External platform message ID | 
**Status** | **string** | Message status | 
**InstanceId** | Pointer to **string** | Instance UUID | [optional] 
**To** | Pointer to **string** | Recipient | [optional] 
**MediaType** | Pointer to **string** | Media type if applicable | [optional] 

## Methods

### NewMessageResponse

`func NewMessageResponse(messageId string, externalMessageId string, status string, ) *MessageResponse`

NewMessageResponse instantiates a new MessageResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMessageResponseWithDefaults

`func NewMessageResponseWithDefaults() *MessageResponse`

NewMessageResponseWithDefaults instantiates a new MessageResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetMessageId

`func (o *MessageResponse) GetMessageId() string`

GetMessageId returns the MessageId field if non-nil, zero value otherwise.

### GetMessageIdOk

`func (o *MessageResponse) GetMessageIdOk() (*string, bool)`

GetMessageIdOk returns a tuple with the MessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageId

`func (o *MessageResponse) SetMessageId(v string)`

SetMessageId sets MessageId field to given value.


### GetExternalMessageId

`func (o *MessageResponse) GetExternalMessageId() string`

GetExternalMessageId returns the ExternalMessageId field if non-nil, zero value otherwise.

### GetExternalMessageIdOk

`func (o *MessageResponse) GetExternalMessageIdOk() (*string, bool)`

GetExternalMessageIdOk returns a tuple with the ExternalMessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExternalMessageId

`func (o *MessageResponse) SetExternalMessageId(v string)`

SetExternalMessageId sets ExternalMessageId field to given value.


### GetStatus

`func (o *MessageResponse) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *MessageResponse) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *MessageResponse) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetInstanceId

`func (o *MessageResponse) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *MessageResponse) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *MessageResponse) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *MessageResponse) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### GetTo

`func (o *MessageResponse) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *MessageResponse) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *MessageResponse) SetTo(v string)`

SetTo sets To field to given value.

### HasTo

`func (o *MessageResponse) HasTo() bool`

HasTo returns a boolean if a field has been set.

### GetMediaType

`func (o *MessageResponse) GetMediaType() string`

GetMediaType returns the MediaType field if non-nil, zero value otherwise.

### GetMediaTypeOk

`func (o *MessageResponse) GetMediaTypeOk() (*string, bool)`

GetMediaTypeOk returns a tuple with the MediaType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMediaType

`func (o *MessageResponse) SetMediaType(v string)`

SetMediaType sets MediaType field to given value.

### HasMediaType

`func (o *MessageResponse) HasMediaType() bool`

HasMediaType returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


