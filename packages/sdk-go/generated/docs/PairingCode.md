# PairingCode

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Code** | **string** | Pairing code to enter on phone | 
**PhoneNumber** | **string** | Masked phone number | 
**Message** | **string** | Instructions for user | 
**ExpiresIn** | **float32** | Seconds until code expires | 

## Methods

### NewPairingCode

`func NewPairingCode(code string, phoneNumber string, message string, expiresIn float32, ) *PairingCode`

NewPairingCode instantiates a new PairingCode object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPairingCodeWithDefaults

`func NewPairingCodeWithDefaults() *PairingCode`

NewPairingCodeWithDefaults instantiates a new PairingCode object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetCode

`func (o *PairingCode) GetCode() string`

GetCode returns the Code field if non-nil, zero value otherwise.

### GetCodeOk

`func (o *PairingCode) GetCodeOk() (*string, bool)`

GetCodeOk returns a tuple with the Code field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCode

`func (o *PairingCode) SetCode(v string)`

SetCode sets Code field to given value.


### GetPhoneNumber

`func (o *PairingCode) GetPhoneNumber() string`

GetPhoneNumber returns the PhoneNumber field if non-nil, zero value otherwise.

### GetPhoneNumberOk

`func (o *PairingCode) GetPhoneNumberOk() (*string, bool)`

GetPhoneNumberOk returns a tuple with the PhoneNumber field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhoneNumber

`func (o *PairingCode) SetPhoneNumber(v string)`

SetPhoneNumber sets PhoneNumber field to given value.


### GetMessage

`func (o *PairingCode) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *PairingCode) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *PairingCode) SetMessage(v string)`

SetMessage sets Message field to given value.


### GetExpiresIn

`func (o *PairingCode) GetExpiresIn() float32`

GetExpiresIn returns the ExpiresIn field if non-nil, zero value otherwise.

### GetExpiresInOk

`func (o *PairingCode) GetExpiresInOk() (*float32, bool)`

GetExpiresInOk returns a tuple with the ExpiresIn field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresIn

`func (o *PairingCode) SetExpiresIn(v float32)`

SetExpiresIn sets ExpiresIn field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


