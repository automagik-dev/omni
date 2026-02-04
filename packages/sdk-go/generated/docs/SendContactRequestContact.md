# SendContactRequestContact

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** | Contact name | 
**Phone** | Pointer to **string** | Phone number | [optional] 
**Email** | Pointer to **string** | Email address | [optional] 
**Organization** | Pointer to **string** | Organization | [optional] 

## Methods

### NewSendContactRequestContact

`func NewSendContactRequestContact(name string, ) *SendContactRequestContact`

NewSendContactRequestContact instantiates a new SendContactRequestContact object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendContactRequestContactWithDefaults

`func NewSendContactRequestContactWithDefaults() *SendContactRequestContact`

NewSendContactRequestContactWithDefaults instantiates a new SendContactRequestContact object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *SendContactRequestContact) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *SendContactRequestContact) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *SendContactRequestContact) SetName(v string)`

SetName sets Name field to given value.


### GetPhone

`func (o *SendContactRequestContact) GetPhone() string`

GetPhone returns the Phone field if non-nil, zero value otherwise.

### GetPhoneOk

`func (o *SendContactRequestContact) GetPhoneOk() (*string, bool)`

GetPhoneOk returns a tuple with the Phone field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhone

`func (o *SendContactRequestContact) SetPhone(v string)`

SetPhone sets Phone field to given value.

### HasPhone

`func (o *SendContactRequestContact) HasPhone() bool`

HasPhone returns a boolean if a field has been set.

### GetEmail

`func (o *SendContactRequestContact) GetEmail() string`

GetEmail returns the Email field if non-nil, zero value otherwise.

### GetEmailOk

`func (o *SendContactRequestContact) GetEmailOk() (*string, bool)`

GetEmailOk returns a tuple with the Email field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmail

`func (o *SendContactRequestContact) SetEmail(v string)`

SetEmail sets Email field to given value.

### HasEmail

`func (o *SendContactRequestContact) HasEmail() bool`

HasEmail returns a boolean if a field has been set.

### GetOrganization

`func (o *SendContactRequestContact) GetOrganization() string`

GetOrganization returns the Organization field if non-nil, zero value otherwise.

### GetOrganizationOk

`func (o *SendContactRequestContact) GetOrganizationOk() (*string, bool)`

GetOrganizationOk returns a tuple with the Organization field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOrganization

`func (o *SendContactRequestContact) SetOrganization(v string)`

SetOrganization sets Organization field to given value.

### HasOrganization

`func (o *SendContactRequestContact) HasOrganization() bool`

HasOrganization returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


