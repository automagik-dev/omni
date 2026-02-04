# SearchPersons200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Person UUID | 
**DisplayName** | **NullableString** | Display name | 
**Email** | **NullableString** | Email address | 
**Phone** | **NullableString** | Phone number | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**UpdatedAt** | **time.Time** | Last update timestamp | 

## Methods

### NewSearchPersons200ResponseItemsInner

`func NewSearchPersons200ResponseItemsInner(id string, displayName NullableString, email NullableString, phone NullableString, createdAt time.Time, updatedAt time.Time, ) *SearchPersons200ResponseItemsInner`

NewSearchPersons200ResponseItemsInner instantiates a new SearchPersons200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSearchPersons200ResponseItemsInnerWithDefaults

`func NewSearchPersons200ResponseItemsInnerWithDefaults() *SearchPersons200ResponseItemsInner`

NewSearchPersons200ResponseItemsInnerWithDefaults instantiates a new SearchPersons200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *SearchPersons200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *SearchPersons200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *SearchPersons200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetDisplayName

`func (o *SearchPersons200ResponseItemsInner) GetDisplayName() string`

GetDisplayName returns the DisplayName field if non-nil, zero value otherwise.

### GetDisplayNameOk

`func (o *SearchPersons200ResponseItemsInner) GetDisplayNameOk() (*string, bool)`

GetDisplayNameOk returns a tuple with the DisplayName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDisplayName

`func (o *SearchPersons200ResponseItemsInner) SetDisplayName(v string)`

SetDisplayName sets DisplayName field to given value.


### SetDisplayNameNil

`func (o *SearchPersons200ResponseItemsInner) SetDisplayNameNil(b bool)`

 SetDisplayNameNil sets the value for DisplayName to be an explicit nil

### UnsetDisplayName
`func (o *SearchPersons200ResponseItemsInner) UnsetDisplayName()`

UnsetDisplayName ensures that no value is present for DisplayName, not even an explicit nil
### GetEmail

`func (o *SearchPersons200ResponseItemsInner) GetEmail() string`

GetEmail returns the Email field if non-nil, zero value otherwise.

### GetEmailOk

`func (o *SearchPersons200ResponseItemsInner) GetEmailOk() (*string, bool)`

GetEmailOk returns a tuple with the Email field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmail

`func (o *SearchPersons200ResponseItemsInner) SetEmail(v string)`

SetEmail sets Email field to given value.


### SetEmailNil

`func (o *SearchPersons200ResponseItemsInner) SetEmailNil(b bool)`

 SetEmailNil sets the value for Email to be an explicit nil

### UnsetEmail
`func (o *SearchPersons200ResponseItemsInner) UnsetEmail()`

UnsetEmail ensures that no value is present for Email, not even an explicit nil
### GetPhone

`func (o *SearchPersons200ResponseItemsInner) GetPhone() string`

GetPhone returns the Phone field if non-nil, zero value otherwise.

### GetPhoneOk

`func (o *SearchPersons200ResponseItemsInner) GetPhoneOk() (*string, bool)`

GetPhoneOk returns a tuple with the Phone field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhone

`func (o *SearchPersons200ResponseItemsInner) SetPhone(v string)`

SetPhone sets Phone field to given value.


### SetPhoneNil

`func (o *SearchPersons200ResponseItemsInner) SetPhoneNil(b bool)`

 SetPhoneNil sets the value for Phone to be an explicit nil

### UnsetPhone
`func (o *SearchPersons200ResponseItemsInner) UnsetPhone()`

UnsetPhone ensures that no value is present for Phone, not even an explicit nil
### GetCreatedAt

`func (o *SearchPersons200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *SearchPersons200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *SearchPersons200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetUpdatedAt

`func (o *SearchPersons200ResponseItemsInner) GetUpdatedAt() time.Time`

GetUpdatedAt returns the UpdatedAt field if non-nil, zero value otherwise.

### GetUpdatedAtOk

`func (o *SearchPersons200ResponseItemsInner) GetUpdatedAtOk() (*time.Time, bool)`

GetUpdatedAtOk returns a tuple with the UpdatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUpdatedAt

`func (o *SearchPersons200ResponseItemsInner) SetUpdatedAt(v time.Time)`

SetUpdatedAt sets UpdatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


