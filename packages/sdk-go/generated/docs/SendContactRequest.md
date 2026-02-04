# SendContactRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**To** | **string** | Recipient | 
**Contact** | [**SendContactRequestContact**](SendContactRequestContact.md) |  | 

## Methods

### NewSendContactRequest

`func NewSendContactRequest(instanceId string, to string, contact SendContactRequestContact, ) *SendContactRequest`

NewSendContactRequest instantiates a new SendContactRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendContactRequestWithDefaults

`func NewSendContactRequestWithDefaults() *SendContactRequest`

NewSendContactRequestWithDefaults instantiates a new SendContactRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendContactRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendContactRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendContactRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendContactRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendContactRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendContactRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetContact

`func (o *SendContactRequest) GetContact() SendContactRequestContact`

GetContact returns the Contact field if non-nil, zero value otherwise.

### GetContactOk

`func (o *SendContactRequest) GetContactOk() (*SendContactRequestContact, bool)`

GetContactOk returns a tuple with the Contact field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetContact

`func (o *SendContactRequest) SetContact(v SendContactRequestContact)`

SetContact sets Contact field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


