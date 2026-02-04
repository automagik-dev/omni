# PersonPresence


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**identities** | [**List[GetPersonPresence200ResponseDataIdentitiesInner]**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 
**summary** | [**GetPersonPresence200ResponseDataSummary**](GetPersonPresence200ResponseDataSummary.md) |  | 
**by_channel** | [**Dict[str, GetPersonPresence200ResponseDataByChannelValue]**](GetPersonPresence200ResponseDataByChannelValue.md) |  | 

## Example

```python
from omni_generated.models.person_presence import PersonPresence

# TODO update the JSON string below
json = "{}"
# create an instance of PersonPresence from a JSON string
person_presence_instance = PersonPresence.from_json(json)
# print the JSON string representation of the object
print(PersonPresence.to_json())

# convert the object into a dict
person_presence_dict = person_presence_instance.to_dict()
# create an instance of PersonPresence from a dict
person_presence_from_dict = PersonPresence.from_dict(person_presence_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


